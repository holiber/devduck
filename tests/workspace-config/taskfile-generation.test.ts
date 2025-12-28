#!/usr/bin/env node

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import YAML from 'yaml';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devduck-test-'));
}

function cleanup(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Taskfile generation from workspace config', () => {
  let tempDir: string;
  const projectRoot = path.resolve(process.cwd());

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  test('generates taskfile with merged config taskfile section', () => {
    // Create a baseline config with taskfile
    const devduckPath = path.join(tempDir, 'devduck', 'src');
    fs.mkdirSync(path.join(devduckPath, 'defaults'), { recursive: true });

    const baselineConfig = {
      version: '0.1.0',
      taskfile: {
        vars: {
          CACHE_DIR: '.cache',
          ARTIFACTS_DIR: '{{.CACHE_DIR}}/artifacts'
        },
        tasks: {
          install: {
            desc: 'Run installation',
            cmds: ['echo Installing']
          },
          'install:1-check-env': {
            desc: 'Check environment',
            cmds: ['echo Checking env']
          }
        }
      }
    };
    fs.writeFileSync(
      path.join(devduckPath, 'defaults', 'workspace.install.yml'),
      YAML.stringify(baselineConfig),
      'utf8'
    );

    // Copy the actual devduck-cli.ts script
    const scriptsDir = path.join(devduckPath, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.cpSync(path.join(projectRoot, 'scripts'), scriptsDir, { recursive: true });

    // Create workspace config that extends baseline
    const workspaceConfig = {
      version: '0.1.0',
      devduck_path: './devduck/src',
      extends: ['devduck:defaults/workspace.install.yml'],
      modules: ['core']
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(workspaceConfig), 'utf8');

    // Run the sync command
    try {
      execSync(
        `tsx ${path.join(projectRoot, 'scripts/devduck-cli.ts')} sync ${tempDir}`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
    } catch (error: any) {
      // Ignore errors from sync command in test environment
      if (!error.stdout?.includes('Generated')) {
        throw error;
      }
    }

    // Verify generated taskfile
    const generatedPath = path.join(tempDir, '.cache', 'taskfile.generated.yml');
    assert.ok(fs.existsSync(generatedPath), 'Generated taskfile should exist');

    const generated = YAML.parse(fs.readFileSync(generatedPath, 'utf8'));
    assert.strictEqual(generated.version, '3');
    assert.ok(generated.vars);
    assert.strictEqual(generated.vars.CACHE_DIR, '.cache');
    assert.strictEqual(generated.vars.ARTIFACTS_DIR, '{{.CACHE_DIR}}/artifacts');
    assert.ok(generated.tasks);
    assert.ok(generated.tasks.install);
    assert.ok(generated.tasks['install:1-check-env']);
  });

  test('falls back to hardcoded tasks when no taskfile section', () => {
    // Create workspace config without taskfile section
    const workspaceConfig = {
      version: '0.1.0',
      devduck_path: '.',
      modules: ['core']
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(workspaceConfig), 'utf8');

    // Run the sync command
    try {
      execSync(
        `tsx ${path.join(projectRoot, 'scripts/devduck-cli.ts')} sync ${tempDir}`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
    } catch (error: any) {
      // Ignore errors from sync command in test environment
      if (!error.stdout?.includes('Generated')) {
        throw error;
      }
    }

    // Verify generated taskfile has fallback tasks
    const generatedPath = path.join(tempDir, '.cache', 'taskfile.generated.yml');
    assert.ok(fs.existsSync(generatedPath), 'Generated taskfile should exist');

    const generated = YAML.parse(fs.readFileSync(generatedPath, 'utf8'));
    assert.ok(generated.tasks);
    assert.ok(generated.tasks.install);
    assert.ok(generated.tasks['install:1-check-env']);
    assert.ok(generated.tasks['install:2-download-repos']);
    assert.ok(generated.tasks['install:7-verify-installation']);
  });

  test('injected vars include DEVDUCK_ROOT and WORKSPACE_ROOT', () => {
    // Create minimal workspace config
    const workspaceConfig = {
      version: '0.1.0',
      devduck_path: './my-devduck',
      modules: ['core']
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(workspaceConfig), 'utf8');

    // Run the sync command
    try {
      execSync(
        `tsx ${path.join(projectRoot, 'scripts/devduck-cli.ts')} sync ${tempDir}`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
    } catch (error: any) {
      // Ignore errors from sync command in test environment
      if (!error.stdout?.includes('Generated')) {
        throw error;
      }
    }

    // Verify injected vars
    const generatedPath = path.join(tempDir, '.cache', 'taskfile.generated.yml');
    const generated = YAML.parse(fs.readFileSync(generatedPath, 'utf8'));
    
    assert.ok(generated.vars);
    assert.strictEqual(generated.vars.DEVDUCK_ROOT, './my-devduck');
    assert.ok(generated.vars.WORKSPACE_ROOT);
  });

  test('workspace taskfile vars override baseline vars', () => {
    // Create a baseline config with taskfile
    const devduckPath = path.join(tempDir, 'devduck', 'src');
    fs.mkdirSync(path.join(devduckPath, 'defaults'), { recursive: true });

    const baselineConfig = {
      version: '0.1.0',
      taskfile: {
        vars: {
          CACHE_DIR: '.cache',
          CUSTOM_VAR: 'baseline-value'
        }
      }
    };
    fs.writeFileSync(
      path.join(devduckPath, 'defaults', 'workspace.install.yml'),
      YAML.stringify(baselineConfig),
      'utf8'
    );

    // Copy scripts
    const scriptsDir = path.join(devduckPath, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.cpSync(path.join(projectRoot, 'scripts'), scriptsDir, { recursive: true });

    // Create workspace config with override
    const workspaceConfig = {
      version: '0.1.0',
      devduck_path: './devduck/src',
      extends: ['devduck:defaults/workspace.install.yml'],
      taskfile: {
        vars: {
          CUSTOM_VAR: 'workspace-override',
          NEW_VAR: 'new-value'
        }
      }
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(workspaceConfig), 'utf8');

    // Run the sync command
    try {
      execSync(
        `tsx ${path.join(projectRoot, 'scripts/devduck-cli.ts')} sync ${tempDir}`,
        { encoding: 'utf8', stdio: 'pipe' }
      );
    } catch (error: any) {
      if (!error.stdout?.includes('Generated')) {
        throw error;
      }
    }

    // Verify merged vars
    const generatedPath = path.join(tempDir, '.cache', 'taskfile.generated.yml');
    const generated = YAML.parse(fs.readFileSync(generatedPath, 'utf8'));
    
    assert.ok(generated.vars);
    assert.strictEqual(generated.vars.CACHE_DIR, '.cache');
    assert.strictEqual(generated.vars.CUSTOM_VAR, 'workspace-override');
    assert.strictEqual(generated.vars.NEW_VAR, 'new-value');
  });
});
