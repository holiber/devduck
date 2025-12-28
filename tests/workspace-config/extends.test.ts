#!/usr/bin/env node

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { readWorkspaceConfigFileWithExtends } from '../../scripts/lib/workspace-config.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devduck-test-'));
}

function cleanup(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('workspace-config extends resolution', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanup(tempDir);
  });

  test('loads config without extends', () => {
    const configPath = path.join(tempDir, 'workspace.config.yml');
    const config = {
      version: '0.1.0',
      modules: ['core', 'cursor']
    };
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    const result = readWorkspaceConfigFileWithExtends(configPath, tempDir);
    assert.ok(result);
    assert.strictEqual(result.version, '0.1.0');
    assert.deepStrictEqual(result.modules, ['core', 'cursor']);
  });

  test('extends single base config with relative path', () => {
    const baseConfig = {
      version: '0.1.0',
      modules: ['core'],
      checks: [{ name: 'base-check' }]
    };
    fs.mkdirSync(path.join(tempDir, 'defaults'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'defaults', 'base.yml'),
      YAML.stringify(baseConfig),
      'utf8'
    );

    const config = {
      version: '0.1.0',
      extends: ['./defaults/base.yml'],
      modules: ['cursor']
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    const result = readWorkspaceConfigFileWithExtends(configPath, tempDir);
    assert.ok(result);
    assert.deepStrictEqual(result.modules, ['core', 'cursor']);
    assert.deepStrictEqual(result.checks, [{ name: 'base-check' }]);
  });

  test('extends with devduck: prefix resolves to devduck_path', () => {
    const devduckPath = path.join(tempDir, 'devduck', 'src');
    fs.mkdirSync(path.join(devduckPath, 'defaults'), { recursive: true });

    const baseConfig = {
      version: '0.1.0',
      taskfile: {
        vars: { CACHE_DIR: '.cache' },
        tasks: { install: { desc: 'Install' } }
      }
    };
    fs.writeFileSync(
      path.join(devduckPath, 'defaults', 'workspace.install.yml'),
      YAML.stringify(baseConfig),
      'utf8'
    );

    const config = {
      version: '0.1.0',
      devduck_path: './devduck/src',
      extends: ['devduck:defaults/workspace.install.yml'],
      modules: ['core']
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    const result = readWorkspaceConfigFileWithExtends(configPath, tempDir);
    assert.ok(result);
    assert.ok(result.taskfile);
    assert.deepStrictEqual(result.taskfile.vars, { CACHE_DIR: '.cache' });
    assert.ok(result.taskfile.tasks?.install);
  });

  test('deep merge objects', () => {
    const baseConfig = {
      version: '0.1.0',
      taskfile: {
        vars: { VAR1: 'base', VAR2: 'base' },
        tasks: { task1: { desc: 'Task 1' } }
      }
    };
    fs.mkdirSync(path.join(tempDir, 'defaults'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'defaults', 'base.yml'),
      YAML.stringify(baseConfig),
      'utf8'
    );

    const config = {
      version: '0.1.0',
      extends: ['./defaults/base.yml'],
      taskfile: {
        vars: { VAR2: 'override', VAR3: 'new' },
        tasks: { task2: { desc: 'Task 2' } }
      }
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    const result = readWorkspaceConfigFileWithExtends(configPath, tempDir);
    assert.ok(result);
    assert.ok(result.taskfile);
    assert.deepStrictEqual(result.taskfile.vars, {
      VAR1: 'base',
      VAR2: 'override',
      VAR3: 'new'
    });
    assert.ok(result.taskfile.tasks?.task1);
    assert.ok(result.taskfile.tasks?.task2);
  });

  test('concat and dedupe arrays - projects by src', () => {
    const baseConfig = {
      version: '0.1.0',
      projects: [
        { src: 'project-a', name: 'A' },
        { src: 'project-b', name: 'B' }
      ]
    };
    fs.mkdirSync(path.join(tempDir, 'defaults'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'defaults', 'base.yml'),
      YAML.stringify(baseConfig),
      'utf8'
    );

    const config = {
      version: '0.1.0',
      extends: ['./defaults/base.yml'],
      projects: [
        { src: 'project-b', name: 'B-override' },
        { src: 'project-c', name: 'C' }
      ]
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    const result = readWorkspaceConfigFileWithExtends(configPath, tempDir);
    assert.ok(result);
    assert.strictEqual(result.projects?.length, 3);
    assert.strictEqual(result.projects?.[0].src, 'project-a');
    assert.strictEqual(result.projects?.[1].src, 'project-b');
    assert.strictEqual(result.projects?.[2].src, 'project-c');
  });

  test('concat and dedupe arrays - checks by name', () => {
    const baseConfig = {
      version: '0.1.0',
      checks: [
        { name: 'check-1', test: 'base-test-1' },
        { name: 'check-2', test: 'base-test-2' }
      ]
    };
    fs.mkdirSync(path.join(tempDir, 'defaults'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'defaults', 'base.yml'),
      YAML.stringify(baseConfig),
      'utf8'
    );

    const config = {
      version: '0.1.0',
      extends: ['./defaults/base.yml'],
      checks: [
        { name: 'check-2', test: 'override-test-2' },
        { name: 'check-3', test: 'test-3' }
      ]
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    const result = readWorkspaceConfigFileWithExtends(configPath, tempDir);
    assert.ok(result);
    assert.strictEqual(result.checks?.length, 3);
    assert.strictEqual(result.checks?.[0].name, 'check-1');
    assert.strictEqual(result.checks?.[1].name, 'check-2');
    assert.strictEqual(result.checks?.[2].name, 'check-3');
  });

  test('concat and dedupe arrays - env by name', () => {
    const baseConfig = {
      version: '0.1.0',
      env: [
        { name: 'VAR1', default: 'base1' },
        { name: 'VAR2', default: 'base2' }
      ]
    };
    fs.mkdirSync(path.join(tempDir, 'defaults'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'defaults', 'base.yml'),
      YAML.stringify(baseConfig),
      'utf8'
    );

    const config = {
      version: '0.1.0',
      extends: ['./defaults/base.yml'],
      env: [
        { name: 'VAR2', default: 'override2' },
        { name: 'VAR3', default: 'new3' }
      ]
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    const result = readWorkspaceConfigFileWithExtends(configPath, tempDir);
    assert.ok(result);
    assert.strictEqual(result.env?.length, 3);
    assert.strictEqual(result.env?.[0].name, 'VAR1');
    assert.strictEqual(result.env?.[1].name, 'VAR2');
    assert.strictEqual(result.env?.[2].name, 'VAR3');
  });

  test('multiple extends in order - base → mid → workspace', () => {
    const baseConfig = {
      version: '0.1.0',
      modules: ['base-module'],
      checks: [{ name: 'base-check' }]
    };
    fs.mkdirSync(path.join(tempDir, 'defaults'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'defaults', 'base.yml'),
      YAML.stringify(baseConfig),
      'utf8'
    );

    const midConfig = {
      version: '0.1.0',
      extends: ['./base.yml'],  // Relative to mid.yml in defaults/
      modules: ['mid-module'],
      checks: [{ name: 'mid-check' }]
    };
    fs.writeFileSync(
      path.join(tempDir, 'defaults', 'mid.yml'),
      YAML.stringify(midConfig),
      'utf8'
    );

    const config = {
      version: '0.1.0',
      extends: ['./defaults/mid.yml'],  // Relative to workspace.config.yml
      modules: ['workspace-module']
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    const result = readWorkspaceConfigFileWithExtends(configPath, tempDir);
    assert.ok(result);
    assert.deepStrictEqual(result.modules, ['base-module', 'mid-module', 'workspace-module']);
    assert.strictEqual(result.checks?.length, 2);
  });

  test('detects circular extends dependency', () => {
    const config1 = {
      version: '0.1.0',
      extends: ['./config2.yml']
    };
    fs.writeFileSync(path.join(tempDir, 'config1.yml'), YAML.stringify(config1), 'utf8');

    const config2 = {
      version: '0.1.0',
      extends: ['./config1.yml']
    };
    fs.writeFileSync(path.join(tempDir, 'config2.yml'), YAML.stringify(config2), 'utf8');

    assert.throws(
      () => readWorkspaceConfigFileWithExtends(path.join(tempDir, 'config1.yml'), tempDir),
      /Circular extends dependency detected/
    );
  });

  test('throws error for missing extends file', () => {
    const config = {
      version: '0.1.0',
      extends: ['./non-existent.yml']
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    assert.throws(
      () => readWorkspaceConfigFileWithExtends(configPath, tempDir),
      /Cannot load workspace config/
    );
  });

  test('extends field is removed from final config', () => {
    const baseConfig = {
      version: '0.1.0',
      modules: ['core']
    };
    fs.mkdirSync(path.join(tempDir, 'defaults'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'defaults', 'base.yml'),
      YAML.stringify(baseConfig),
      'utf8'
    );

    const config = {
      version: '0.1.0',
      extends: ['./defaults/base.yml'],
      modules: ['cursor']
    };
    const configPath = path.join(tempDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf8');

    const result = readWorkspaceConfigFileWithExtends(configPath, tempDir);
    assert.ok(result);
    assert.strictEqual(result.extends, undefined);
  });
});
