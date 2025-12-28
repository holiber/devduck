#!/usr/bin/env node

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

let tmpDir: string;
const repoRoot = process.cwd();

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devduck-taskfile-test-'));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function runSync(cwd: string, workspacePath?: string) {
  const cliPath = path.join(repoRoot, 'scripts', 'devduck-cli.ts');
  const args = ['tsx', cliPath, 'sync'];
  if (workspacePath) {
    args.push(workspacePath);
  }
  return spawnSync('npx', args, {
    cwd,
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 30_000
  });
}

describe('Taskfile generation', () => {
  test('generates taskfile from config with taskfile section', () => {
    // Create workspace config with taskfile section
    fs.writeFileSync(path.join(tmpDir, 'workspace.config.yml'), YAML.stringify({
      version: '0.1.0',
      devduck_path: repoRoot,
      taskfile: {
        vars: {
          CACHE_DIR: '.cache',
          CUSTOM_VAR: 'custom-value'
        },
        tasks: {
          install: {
            desc: 'Run installation',
            cmds: [{ task: 'install:1' }, { task: 'install:2' }]
          },
          'install:1': {
            desc: 'First step',
            cmds: ['echo step 1']
          },
          'install:2': {
            desc: 'Second step',
            cmds: ['echo step 2']
          }
        }
      }
    }));

    const result = runSync(tmpDir);
    assert.equal(result.status, 0, `sync failed: ${result.stderr}`);
    assert.ok(result.stdout.includes('taskfile.generated.yml'), `stdout: ${result.stdout}`);

    // Read generated taskfile
    const generatedPath = path.join(tmpDir, '.cache', 'taskfile.generated.yml');
    assert.ok(fs.existsSync(generatedPath), 'Generated taskfile should exist');

    const generated = YAML.parse(fs.readFileSync(generatedPath, 'utf8')) as {
      version: string;
      vars: Record<string, string>;
      tasks: Record<string, { desc: string; cmds: unknown[] }>;
    };

    // Check structure
    assert.equal(generated.version, '3');

    // Check vars - should include both DEVDUCK_ROOT/WORKSPACE_ROOT and custom vars
    assert.ok(generated.vars.DEVDUCK_ROOT);
    assert.ok(generated.vars.WORKSPACE_ROOT);
    assert.equal(generated.vars.CUSTOM_VAR, 'custom-value');

    // Check tasks from config
    assert.ok(generated.tasks.install);
    assert.ok(generated.tasks['install:1']);
    assert.ok(generated.tasks['install:2']);
    assert.equal(generated.tasks.install.desc, 'Run installation');
  });

  test('falls back to default taskfile when no taskfile section', () => {
    // Create minimal workspace config without taskfile section
    fs.writeFileSync(path.join(tmpDir, 'workspace.config.yml'), YAML.stringify({
      version: '0.1.0',
      devduck_path: repoRoot,
      modules: ['core']
    }));

    const result = runSync(tmpDir);
    assert.equal(result.status, 0, `sync failed: ${result.stderr}`);

    // Read generated taskfile
    const generatedPath = path.join(tmpDir, '.cache', 'taskfile.generated.yml');
    assert.ok(fs.existsSync(generatedPath), 'Generated taskfile should exist');

    const generated = YAML.parse(fs.readFileSync(generatedPath, 'utf8')) as {
      version: string;
      vars: Record<string, string>;
      tasks: Record<string, { desc: string; cmds: unknown[] }>;
    };

    // Should have default install tasks
    assert.ok(generated.tasks.install, 'Should have install task');
    assert.ok(generated.tasks['install:1-check-env'], 'Should have install:1-check-env task');
    assert.ok(generated.tasks['install:7-verify-installation'], 'Should have install:7 task');
  });

  test('generates taskfile from extended config', () => {
    // Create devduck defaults directory
    const devduckDefaultsDir = path.join(tmpDir, 'devduck', 'defaults');
    fs.mkdirSync(devduckDefaultsDir, { recursive: true });

    // Create base config with taskfile
    fs.writeFileSync(path.join(devduckDefaultsDir, 'workspace.install.yml'), YAML.stringify({
      version: '0.1.0',
      taskfile: {
        vars: {
          CACHE_DIR: '.cache',
          ARTIFACTS_DIR: '.cache/artifacts'
        },
        tasks: {
          install: {
            desc: 'Run full installation',
            cmds: [{ task: 'install:1' }]
          },
          'install:1': {
            desc: 'Base step',
            cmds: ['echo base step']
          }
        }
      }
    }));

    // Create workspace config that extends the base
    fs.writeFileSync(path.join(tmpDir, 'workspace.config.yml'), YAML.stringify({
      version: '0.1.0',
      devduck_path: './devduck',
      extends: ['devduck:defaults/workspace.install.yml'],
      modules: ['core', 'cursor'],
      taskfile: {
        vars: {
          CUSTOM_VAR: 'workspace-specific'
        },
        tasks: {
          'custom-task': {
            desc: 'Workspace custom task',
            cmds: ['echo custom']
          }
        }
      }
    }));

    const result = runSync(tmpDir);
    assert.equal(result.status, 0, `sync failed: ${result.stderr}`);

    // Read generated taskfile
    const generatedPath = path.join(tmpDir, '.cache', 'taskfile.generated.yml');
    const generated = YAML.parse(fs.readFileSync(generatedPath, 'utf8')) as {
      version: string;
      vars: Record<string, string>;
      tasks: Record<string, { desc: string; cmds: unknown[] }>;
    };

    // Should have merged vars
    assert.ok(generated.vars.DEVDUCK_ROOT);
    assert.ok(generated.vars.WORKSPACE_ROOT);
    assert.equal(generated.vars.ARTIFACTS_DIR, '.cache/artifacts'); // from base
    assert.equal(generated.vars.CUSTOM_VAR, 'workspace-specific'); // from workspace

    // Should have merged tasks
    assert.ok(generated.tasks.install, 'Should have install task from base');
    assert.ok(generated.tasks['install:1'], 'Should have install:1 from base');
    assert.ok(generated.tasks['custom-task'], 'Should have custom-task from workspace');
  });

  test('creates Taskfile.yml if missing', () => {
    // Create workspace config
    fs.writeFileSync(path.join(tmpDir, 'workspace.config.yml'), YAML.stringify({
      version: '0.1.0',
      devduck_path: repoRoot,
      modules: ['core']
    }));

    const result = runSync(tmpDir);
    assert.equal(result.status, 0, `sync failed: ${result.stderr}`);

    // Check Taskfile.yml was created
    const taskfilePath = path.join(tmpDir, 'Taskfile.yml');
    assert.ok(fs.existsSync(taskfilePath), 'Taskfile.yml should be created');

    const taskfile = fs.readFileSync(taskfilePath, 'utf8');
    assert.ok(taskfile.includes('includes:'), 'Should include devduck taskfile');
    assert.ok(taskfile.includes('sync:'), 'Should have sync task');
    assert.ok(taskfile.includes('install:'), 'Should have install task');
  });

  test('DEVDUCK_ROOT and WORKSPACE_ROOT are always injected', () => {
    // Create config that tries to override DEVDUCK_ROOT
    fs.writeFileSync(path.join(tmpDir, 'workspace.config.yml'), YAML.stringify({
      version: '0.1.0',
      devduck_path: './my-devduck',
      taskfile: {
        vars: {
          // Try to not set DEVDUCK_ROOT - it should still be there
          CUSTOM: 'value'
        },
        tasks: {
          test: { desc: 'Test', cmds: ['echo test'] }
        }
      }
    }));

    const result = runSync(tmpDir);
    assert.equal(result.status, 0, `sync failed: ${result.stderr}`);

    const generatedPath = path.join(tmpDir, '.cache', 'taskfile.generated.yml');
    const generated = YAML.parse(fs.readFileSync(generatedPath, 'utf8')) as {
      vars: Record<string, string>;
    };

    // DEVDUCK_ROOT should be set to the config's devduck_path
    assert.equal(generated.vars.DEVDUCK_ROOT, './my-devduck');
    // WORKSPACE_ROOT should have the default template
    assert.ok(generated.vars.WORKSPACE_ROOT.includes('default'));
  });
});

describe('Integration with real baseline config', () => {
  test('can extend from actual devduck defaults/workspace.install.yml', () => {
    // This test uses the actual baseline we created
    fs.writeFileSync(path.join(tmpDir, 'workspace.config.yml'), YAML.stringify({
      version: '0.1.0',
      devduck_path: repoRoot,
      extends: ['devduck:defaults/workspace.install.yml'],
      modules: ['core', 'cursor']
    }));

    const result = runSync(tmpDir);
    assert.equal(result.status, 0, `sync failed: ${result.stderr}`);

    const generatedPath = path.join(tmpDir, '.cache', 'taskfile.generated.yml');
    const generated = YAML.parse(fs.readFileSync(generatedPath, 'utf8')) as {
      version: string;
      vars: Record<string, string>;
      tasks: Record<string, { desc: string; cmds: unknown[] }>;
    };

    // Should have vars from baseline
    assert.equal(generated.vars.CACHE_DIR, '.cache');
    assert.equal(generated.vars.ARTIFACTS_DIR, '.cache/artifacts');

    // Should have all install tasks from baseline
    assert.ok(generated.tasks.install, 'Should have install task');
    assert.ok(generated.tasks['install:1-check-env'], 'Should have install:1-check-env');
    assert.ok(generated.tasks['install:2-download-repos'], 'Should have install:2-download-repos');
    assert.ok(generated.tasks['install:3-download-projects'], 'Should have install:3-download-projects');
    assert.ok(generated.tasks['install:4-check-env-again'], 'Should have install:4-check-env-again');
    assert.ok(generated.tasks['install:5-setup-modules'], 'Should have install:5-setup-modules');
    assert.ok(generated.tasks['install:6-setup-projects'], 'Should have install:6-setup-projects');
    assert.ok(generated.tasks['install:7-verify-installation'], 'Should have install:7-verify-installation');

    // The install task should reference all sub-tasks
    const installCmds = generated.tasks.install.cmds as Array<{ task: string }>;
    assert.equal(installCmds.length, 7, 'install should have 7 sub-tasks');
  });
});
