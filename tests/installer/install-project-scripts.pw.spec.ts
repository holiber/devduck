/**
 * Tests for install-project-scripts functionality
 * Migrated to Playwright Test
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import { installProjectScripts } from '../../scripts/install/install-project-scripts.js';
import { createWorkspaceFromFixture, cleanupTempWorkspace } from './helpers.js';

/**
 * Read JSON file
 */
async function readJSON(filePath: string): Promise<any> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

test.describe('Install Project Scripts', () => {
  let tempWorkspace: string;

  test.beforeAll(async () => {
    tempWorkspace = await createWorkspaceFromFixture('empty', {
      prefix: 'devduck-scripts-test-'
    });
  });

  test.afterAll(async () => {
    if (tempWorkspace) {
      await cleanupTempWorkspace(tempWorkspace);
    }
  });

  test('@smoke Install default scripts from project', async () => {
    // Create workspace package.json
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {}
    };
    await fs.writeFile(
      path.join(tempWorkspace, 'package.json'),
      JSON.stringify(workspacePackageJson, null, 2),
      'utf8'
    );

    // Create project directory and package.json
    const projectName = 'test-project';
    const projectsDir = path.join(tempWorkspace, 'projects');
    await fs.mkdir(projectsDir, { recursive: true });
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const projectPackageJson = {
      name: projectName,
      version: '1.0.0',
      scripts: {
        test: 'jest',
        dev: 'node dev.js',
        build: 'npm run build:prod',
        start: 'node index.js',
        lint: 'eslint .',
        custom: 'echo custom'
      }
    };
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify(projectPackageJson, null, 2),
      'utf8'
    );

    // Create config
    const config = {
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    const logMessages: string[] = [];
    const log = (msg: string) => logMessages.push(msg);

    // Install scripts
    installProjectScripts(tempWorkspace, config.projects, config, log);

    // Verify workspace package.json
    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));
    expect(updatedWorkspacePackageJson).toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts).toBeTruthy();

    // Check that default scripts are installed
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:test`]).toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:dev`]).toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:build`]).toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:start`]).toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:lint`]).toBeTruthy();

    // Check that custom script is NOT installed (not in default list)
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:custom`]).toBeFalsy();

    // Check that scripts use --prefix to avoid changing directory
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:test`]).toBe(
      `npm run --prefix projects/${projectName} test`
    );
  });

  test('@smoke Install additional scripts via importScripts', async () => {
    // Create workspace package.json
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {}
    };
    await fs.writeFile(
      path.join(tempWorkspace, 'package.json'),
      JSON.stringify(workspacePackageJson, null, 2),
      'utf8'
    );

    // Create project
    const projectName = 'test-project-2';
    const projectsDir = path.join(tempWorkspace, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const projectPackageJson = {
      name: projectName,
      version: '1.0.0',
      scripts: {
        test: 'jest',
        format: 'prettier --write .',
        'type-check': 'tsc --noEmit',
        custom: 'echo custom'
      }
    };
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify(projectPackageJson, null, 2),
      'utf8'
    );

    // Create config with importScripts
    const config = {
      importScripts: ['format', 'type-check'],
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    // Install scripts
    installProjectScripts(tempWorkspace, config.projects, config);

    // Verify workspace package.json
    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));

    // Check that default scripts are installed
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:test`]).toBeTruthy();

    // Check that importScripts are installed
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:format`]).toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:type-check`]).toBeTruthy();

    // Check that custom script is NOT installed
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:custom`]).toBeFalsy();
  });

  test('@smoke Remove scripts when project is removed from config', async () => {
    // Create workspace package.json with existing project scripts
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {
        'old-project:test': 'npm run --prefix projects/old-project test',
        'old-project:dev': 'npm run --prefix projects/old-project dev',
        'other-script': 'echo other'
      }
    };
    await fs.writeFile(
      path.join(tempWorkspace, 'package.json'),
      JSON.stringify(workspacePackageJson, null, 2),
      'utf8'
    );

    // Create new project
    const projectName = 'new-project';
    const projectsDir = path.join(tempWorkspace, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const projectPackageJson = {
      name: projectName,
      version: '1.0.0',
      scripts: {
        test: 'jest'
      }
    };
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify(projectPackageJson, null, 2),
      'utf8'
    );

    // Create config with only new project (old-project removed)
    const config = {
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    // Install scripts
    installProjectScripts(tempWorkspace, config.projects, config);

    // Verify workspace package.json
    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));

    // Check that old project scripts are removed
    expect(updatedWorkspacePackageJson.scripts['old-project:test']).toBeFalsy();
    expect(updatedWorkspacePackageJson.scripts['old-project:dev']).toBeFalsy();

    // Check that new project scripts are installed
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:test`]).toBeTruthy();

    // Check that non-project scripts are preserved
    expect(updatedWorkspacePackageJson.scripts['other-script']).toBeTruthy();
  });

  test('@smoke Handle missing project package.json gracefully', async () => {
    // Create workspace package.json
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {}
    };
    await fs.writeFile(
      path.join(tempWorkspace, 'package.json'),
      JSON.stringify(workspacePackageJson, null, 2),
      'utf8'
    );

    // Create project directory but no package.json
    const projectName = 'missing-package-project';
    const projectsDir = path.join(tempWorkspace, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    // Create config
    const config = {
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    const logMessages: string[] = [];
    const log = (msg: string) => logMessages.push(msg);

    // Install scripts (should not crash)
    installProjectScripts(tempWorkspace, config.projects, config, log);

    // Verify workspace package.json is unchanged
    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));
    expect(updatedWorkspacePackageJson).toBeTruthy();
    expect(Object.keys(updatedWorkspacePackageJson.scripts || {}).length).toBe(0);
  });

  test('@smoke Verify scripts do not change current directory', async () => {
    // Create workspace package.json
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {}
    };
    await fs.writeFile(
      path.join(tempWorkspace, 'package.json'),
      JSON.stringify(workspacePackageJson, null, 2),
      'utf8'
    );

    // Create project
    const projectName = 'cd-test-project';
    const projectsDir = path.join(tempWorkspace, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const projectPackageJson = {
      name: projectName,
      version: '1.0.0',
      scripts: {
        test: 'jest'
      }
    };
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify(projectPackageJson, null, 2),
      'utf8'
    );

    // Create config
    const config = {
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    // Install scripts
    installProjectScripts(tempWorkspace, config.projects, config);

    // Verify workspace package.json
    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));

    // Check that script uses --prefix (doesn't change directory)
    const scriptCommand = updatedWorkspacePackageJson.scripts[`${projectName}:test`];
    expect(scriptCommand).toBeTruthy();
    expect(scriptCommand).toContain('--prefix');
    expect(scriptCommand).not.toContain('cd ');
  });
});
