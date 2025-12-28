import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { installProjectScripts } from '../../scripts/install/install-project-scripts.js';
import { createWorkspaceFromFixture, cleanupTempWorkspace } from './helpers.js';

type JsonObject = Record<string, any>;

async function readJSON(filePath: string): Promise<JsonObject | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as JsonObject;
  } catch {
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

  test('Install default scripts from project @smoke', async () => {
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {} as Record<string, string>
    };
    await fs.writeFile(path.join(tempWorkspace, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

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
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(projectPackageJson, null, 2), 'utf8');

    const config = {
      projects: [{ src: `github.com/test/${projectName}` }]
    };

    const logMessages: string[] = [];
    const log = (msg: string) => logMessages.push(msg);

    installProjectScripts(tempWorkspace, config.projects, config as any, log);

    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));
    expect(updatedWorkspacePackageJson, 'Workspace package.json should exist').toBeTruthy();
    expect(updatedWorkspacePackageJson?.scripts, 'Scripts section should exist').toBeTruthy();

    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:test`]).toBeTruthy();
    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:dev`]).toBeTruthy();
    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:build`]).toBeTruthy();
    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:start`]).toBeTruthy();
    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:lint`]).toBeTruthy();

    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:custom`], 'custom script should not be installed').toBeFalsy();

    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:test`]).toBe(`npm run --prefix projects/${projectName} test`);
  });

  test('Install additional scripts via importScripts @smoke', async () => {
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {} as Record<string, string>
    };
    await fs.writeFile(path.join(tempWorkspace, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

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
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(projectPackageJson, null, 2), 'utf8');

    const config = {
      importScripts: ['format', 'type-check'],
      projects: [{ src: `github.com/test/${projectName}` }]
    };

    installProjectScripts(tempWorkspace, config.projects, config as any);

    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));
    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:test`]).toBeTruthy();
    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:format`]).toBeTruthy();
    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:type-check`]).toBeTruthy();
    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:custom`], 'custom script should not be installed').toBeFalsy();
  });

  test('Remove scripts when project is removed from config @smoke', async () => {
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {
        'old-project:test': 'npm run --prefix projects/old-project test',
        'old-project:dev': 'npm run --prefix projects/old-project dev',
        'other-script': 'echo other'
      }
    };
    await fs.writeFile(path.join(tempWorkspace, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

    const projectName = 'new-project';
    const projectsDir = path.join(tempWorkspace, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const projectPackageJson = { name: projectName, version: '1.0.0', scripts: { test: 'jest' } };
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(projectPackageJson, null, 2), 'utf8');

    const config = { projects: [{ src: `github.com/test/${projectName}` }] };
    installProjectScripts(tempWorkspace, config.projects, config as any);

    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));
    expect(updatedWorkspacePackageJson?.scripts?.['old-project:test']).toBeFalsy();
    expect(updatedWorkspacePackageJson?.scripts?.['old-project:dev']).toBeFalsy();
    expect(updatedWorkspacePackageJson?.scripts?.[`${projectName}:test`]).toBeTruthy();
    expect(updatedWorkspacePackageJson?.scripts?.['other-script']).toBeTruthy();
  });

  test('Handle missing project package.json gracefully @smoke', async () => {
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {} as Record<string, string>
    };
    await fs.writeFile(path.join(tempWorkspace, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

    const projectName = 'missing-package-project';
    const projectsDir = path.join(tempWorkspace, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const config = { projects: [{ src: `github.com/test/${projectName}` }] };

    const logMessages: string[] = [];
    const log = (msg: string) => logMessages.push(msg);

    installProjectScripts(tempWorkspace, config.projects, config as any, log);

    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));
    expect(updatedWorkspacePackageJson, 'Workspace package.json should exist').toBeTruthy();
    expect(Object.keys((updatedWorkspacePackageJson?.scripts as Record<string, string>) || {}).length).toBe(0);
  });

  test('Verify scripts do not change current directory @smoke', async () => {
    const workspacePackageJson = {
      name: 'test-workspace',
      version: '1.0.0',
      scripts: {} as Record<string, string>
    };
    await fs.writeFile(path.join(tempWorkspace, 'package.json'), JSON.stringify(workspacePackageJson, null, 2), 'utf8');

    const projectName = 'cd-test-project';
    const projectsDir = path.join(tempWorkspace, 'projects');
    const projectDir = path.join(projectsDir, projectName);
    await fs.mkdir(projectDir, { recursive: true });

    const projectPackageJson = { name: projectName, version: '1.0.0', scripts: { test: 'jest' } };
    await fs.writeFile(path.join(projectDir, 'package.json'), JSON.stringify(projectPackageJson, null, 2), 'utf8');

    const config = { projects: [{ src: `github.com/test/${projectName}` }] };
    installProjectScripts(tempWorkspace, config.projects, config as any);

    const updatedWorkspacePackageJson = await readJSON(path.join(tempWorkspace, 'package.json'));
    const scriptCommand = (updatedWorkspacePackageJson?.scripts as Record<string, string> | undefined)?.[`${projectName}:test`];
    expect(scriptCommand, 'Script should exist').toBeTruthy();
    expect(scriptCommand).toContain('--prefix');
    expect(scriptCommand).not.toContain('cd ');
  });
});

