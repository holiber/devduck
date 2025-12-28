/**
 * Playwright Test port of `install-project-scripts.test.ts`
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { installProjectScripts } from '../../scripts/install/install-project-scripts.ts';
import { createWorkspaceFromFixture, cleanupTempWorkspace } from './helpers.ts';

async function readJSON(filePath: string): Promise<any> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

test.describe('Install Project Scripts', () => {
  test.describe.configure({ mode: 'serial' });

  let tempWorkspace: string | null = null;

  test.beforeAll(async () => {
    tempWorkspace = await createWorkspaceFromFixture('empty', {
      prefix: 'devduck-scripts-test-'
    });
  });

  test.afterAll(async () => {
    if (tempWorkspace) await cleanupTempWorkspace(tempWorkspace);
  });

  test('@smoke Install default scripts from project', async () => {
    expect(tempWorkspace).toBeTruthy();
    const ws = tempWorkspace as string;

    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {}
    };
    await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

    const projectName = 'test-project';
    const projectsDir = path.join(ws, 'projects');
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
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(projectPackageJson, null, 2), 'utf8');

    const config = {
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    const logMessages: string[] = [];
    const log = (msg: string) => logMessages.push(msg);

    installProjectScripts(ws, config.projects, config, log);

    const updatedWorkspacePackageJson = await readJSON(path.join(ws, 'package.json'));
    expect(updatedWorkspacePackageJson, 'Workspace package.json should exist').toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts, 'Scripts section should exist').toBeTruthy();

    expect(updatedWorkspacePackageJson.scripts[`${projectName}:test`], 'test script should be installed').toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:dev`], 'dev script should be installed').toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:build`], 'build script should be installed').toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:start`], 'start script should be installed').toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:lint`], 'lint script should be installed').toBeTruthy();

    expect(updatedWorkspacePackageJson.scripts[`${projectName}:custom`], 'custom script should not be installed').toBeFalsy();

    expect(
      updatedWorkspacePackageJson.scripts[`${projectName}:test`],
      'Script should use --prefix'
    ).toBe(`npm run --prefix projects/${projectName} test`);
  });

  test('@smoke Install additional scripts via importScripts', async () => {
    expect(tempWorkspace).toBeTruthy();
    const ws = tempWorkspace as string;

    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {}
    };
    await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

    const projectName = 'test-project-2';
    const projectsDir = path.join(ws, 'projects');
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
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(projectPackageJson, null, 2), 'utf8');

    const config = {
      importScripts: ['format', 'type-check'],
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    installProjectScripts(ws, config.projects, config);

    const updatedWorkspacePackageJson = await readJSON(path.join(ws, 'package.json'));
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:test`], 'test script should be installed').toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:format`], 'format script should be installed').toBeTruthy();
    expect(
      updatedWorkspacePackageJson.scripts[`${projectName}:type-check`],
      'type-check script should be installed'
    ).toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:custom`], 'custom script should not be installed').toBeFalsy();
  });

  test('Remove scripts when project is removed from config', async () => {
    expect(tempWorkspace).toBeTruthy();
    const ws = tempWorkspace as string;

    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {
        'old-project:test': 'npm run --prefix projects/old-project test',
        'old-project:dev': 'npm run --prefix projects/old-project dev',
        'other-script': 'echo other'
      }
    };
    await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

    const projectName = 'new-project';
    const projectsDir = path.join(ws, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const projectPackageJson = {
      name: projectName,
      version: '1.0.0',
      scripts: {
        test: 'jest'
      }
    };
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(projectPackageJson, null, 2), 'utf8');

    const config = {
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    installProjectScripts(ws, config.projects, config);

    const updatedWorkspacePackageJson = await readJSON(path.join(ws, 'package.json'));
    expect(updatedWorkspacePackageJson.scripts['old-project:test'], 'old-project:test should be removed').toBeFalsy();
    expect(updatedWorkspacePackageJson.scripts['old-project:dev'], 'old-project:dev should be removed').toBeFalsy();
    expect(updatedWorkspacePackageJson.scripts[`${projectName}:test`], 'new-project:test should be installed').toBeTruthy();
    expect(updatedWorkspacePackageJson.scripts['other-script'], 'other-script should be preserved').toBeTruthy();
  });

  test('@smoke Handle missing project package.json gracefully', async () => {
    expect(tempWorkspace).toBeTruthy();
    const ws = tempWorkspace as string;

    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {}
    };
    await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

    const projectName = 'missing-package-project';
    const projectsDir = path.join(ws, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const config = {
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    const logMessages: string[] = [];
    const log = (msg: string) => logMessages.push(msg);

    installProjectScripts(ws, config.projects, config, log);

    const updatedWorkspacePackageJson = await readJSON(path.join(ws, 'package.json'));
    expect(updatedWorkspacePackageJson, 'Workspace package.json should exist').toBeTruthy();
    expect(Object.keys(updatedWorkspacePackageJson.scripts || {}).length, 'No scripts should be added').toBe(0);
  });

  test('@smoke Verify scripts do not change current directory', async () => {
    expect(tempWorkspace).toBeTruthy();
    const ws = tempWorkspace as string;

    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {}
    };
    await fs.writeFile(path.join(ws, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

    const projectName = 'cd-test-project';
    const projectsDir = path.join(ws, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const projectPackageJson = {
      name: projectName,
      version: '1.0.0',
      scripts: {
        test: 'jest'
      }
    };
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(projectPackageJson, null, 2), 'utf8');

    const config = {
      projects: [
        {
          src: `github.com/test/${projectName}`
        }
      ]
    };

    installProjectScripts(ws, config.projects, config);

    const updatedWorkspacePackageJson = await readJSON(path.join(ws, 'package.json'));
    const scriptCommand = updatedWorkspacePackageJson.scripts[`${projectName}:test`];
    expect(scriptCommand, 'Script should exist').toBeTruthy();
    expect(scriptCommand.includes('--prefix'), 'Script should use --prefix flag').toBeTruthy();
    expect(scriptCommand.includes('cd '), 'Script should not use cd command').toBeFalsy();
  });
});

