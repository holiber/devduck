#!/usr/bin/env node

/**
 * Tests for install-project-scripts functionality
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import { installProjectScripts } from '../../scripts/install/install-project-scripts.js';

/**
 * Create a temporary directory for testing
 */
async function createTempWorkspace() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devduck-scripts-test-'));
  return tmpDir;
}

/**
 * Clean up temporary workspace
 */
async function cleanupTempWorkspace(workspacePath) {
  if (!workspacePath || !workspacePath.includes('devduck-scripts-test-')) {
    throw new Error('Safety check: Only cleaning up test directories');
  }
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Warning: Failed to cleanup ${workspacePath}: ${error.message}`);
  }
}

/**
 * Read JSON file
 */
async function readJSON(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

describe('Install Project Scripts', () => {
  let tempWorkspace;

  before(async () => {
    tempWorkspace = await createTempWorkspace();
  });

  after(async () => {
    if (tempWorkspace) {
      await cleanupTempWorkspace(tempWorkspace);
    }
  });

  test('Install default scripts from project', async () => {
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

    const logMessages = [];
    const log = (msg) => logMessages.push(msg);

    // Install scripts
    installProjectScripts(tempWorkspace, config.projects, config, log);

    // Verify workspace package.json
    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));
    assert.ok(updatedWorkspacePackageJson, 'Workspace package.json should exist');
    assert.ok(updatedWorkspacePackageJson.scripts, 'Scripts section should exist');

    // Check that default scripts are installed
    assert.ok(updatedWorkspacePackageJson.scripts[`${projectName}:test`], 'test script should be installed');
    assert.ok(updatedWorkspacePackageJson.scripts[`${projectName}:dev`], 'dev script should be installed');
    assert.ok(updatedWorkspacePackageJson.scripts[`${projectName}:build`], 'build script should be installed');
    assert.ok(updatedWorkspacePackageJson.scripts[`${projectName}:start`], 'start script should be installed');
    assert.ok(updatedWorkspacePackageJson.scripts[`${projectName}:lint`], 'lint script should be installed');

    // Check that custom script is NOT installed (not in default list)
    assert.ok(!updatedWorkspacePackageJson.scripts[`${projectName}:custom`], 'custom script should not be installed');

    // Check that scripts use --prefix to avoid changing directory
    assert.strictEqual(
      updatedWorkspacePackageJson.scripts[`${projectName}:test`],
      `npm run --prefix projects/${projectName} test`,
      'Script should use --prefix'
    );
  });

  test('Install additional scripts via importScripts', async () => {
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
    assert.ok(updatedWorkspacePackageJson.scripts[`${projectName}:test`], 'test script should be installed');

    // Check that importScripts are installed
    assert.ok(updatedWorkspacePackageJson.scripts[`${projectName}:format`], 'format script should be installed');
    assert.ok(updatedWorkspacePackageJson.scripts[`${projectName}:type-check`], 'type-check script should be installed');

    // Check that custom script is NOT installed
    assert.ok(!updatedWorkspacePackageJson.scripts[`${projectName}:custom`], 'custom script should not be installed');
  });

  test('Remove scripts when project is removed from config', async () => {
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
    assert.ok(!updatedWorkspacePackageJson.scripts['old-project:test'], 'old-project:test should be removed');
    assert.ok(!updatedWorkspacePackageJson.scripts['old-project:dev'], 'old-project:dev should be removed');

    // Check that new project scripts are installed
    assert.ok(updatedWorkspacePackageJson.scripts[`${projectName}:test`], 'new-project:test should be installed');

    // Check that non-project scripts are preserved
    assert.ok(updatedWorkspacePackageJson.scripts['other-script'], 'other-script should be preserved');
  });

  test('Handle missing project package.json gracefully', async () => {
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

    const logMessages = [];
    const log = (msg) => logMessages.push(msg);

    // Install scripts (should not crash)
    installProjectScripts(tempWorkspace, config.projects, config, log);

    // Verify workspace package.json is unchanged
    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));
    assert.ok(updatedWorkspacePackageJson, 'Workspace package.json should exist');
    assert.strictEqual(Object.keys(updatedWorkspacePackageJson.scripts || {}).length, 0, 'No scripts should be added');
  });

  test('Verify scripts do not change current directory', async () => {
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
    assert.ok(scriptCommand, 'Script should exist');
    assert.ok(scriptCommand.includes('--prefix'), 'Script should use --prefix flag');
    assert.ok(!scriptCommand.includes('cd '), 'Script should not use cd command');
  });
});

