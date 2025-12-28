#!/usr/bin/env node

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import {
  resolveExtendsPath,
  deepMergeConfigs,
  loadConfigWithExtends,
  readMergedWorkspaceConfig
} from '../../scripts/lib/workspace-config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devduck-extends-test-'));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('resolveExtendsPath', () => {
  test('resolves devduck: paths with devduck_path set', () => {
    const devduckPath = '/workspace/devduck';
    const baseDir = '/workspace';
    const result = resolveExtendsPath('devduck:defaults/workspace.install.yml', baseDir, devduckPath);
    assert.equal(result, '/workspace/devduck/defaults/workspace.install.yml');
  });

  test('resolves devduck: paths with relative devduck_path', () => {
    const devduckPath = './devduck/src';
    const baseDir = '/workspace';
    const result = resolveExtendsPath('devduck:defaults/workspace.install.yml', baseDir, devduckPath);
    assert.equal(result, path.resolve('/workspace/devduck/src/defaults/workspace.install.yml'));
  });

  test('throws error when devduck: path used without devduck_path', () => {
    assert.throws(
      () => resolveExtendsPath('devduck:defaults/workspace.install.yml', '/workspace', null),
      /devduck_path is not set/
    );
  });

  test('resolves absolute paths directly', () => {
    const result = resolveExtendsPath('/absolute/path/to/config.yml', '/workspace', './devduck');
    assert.equal(result, '/absolute/path/to/config.yml');
  });

  test('resolves relative paths from baseDir', () => {
    const result = resolveExtendsPath('./base/config.yml', '/workspace', './devduck');
    assert.equal(result, path.resolve('/workspace/base/config.yml'));
  });
});

describe('deepMergeConfigs', () => {
  test('deep merges nested objects', () => {
    const base = {
      version: '0.1.0',
      moduleSettings: { git: { enabled: true } }
    };
    const override = {
      moduleSettings: { git: { branch: 'main' }, cursor: { theme: 'dark' } }
    };
    const result = deepMergeConfigs(base, override);

    assert.deepEqual(result, {
      version: '0.1.0',
      moduleSettings: {
        git: { enabled: true, branch: 'main' },
        cursor: { theme: 'dark' }
      }
    });
  });

  test('concats and dedupes projects array by src', () => {
    const base = {
      projects: [
        { src: 'project-a', description: 'Project A' },
        { src: 'project-b', description: 'Project B' }
      ]
    };
    const override = {
      projects: [
        { src: 'project-b', description: 'Updated Project B' },
        { src: 'project-c', description: 'Project C' }
      ]
    };
    const result = deepMergeConfigs(base, override) as { projects: Array<{ src: string; description: string }> };

    assert.equal(result.projects.length, 3);
    assert.deepEqual(result.projects[0], { src: 'project-a', description: 'Project A' });
    assert.deepEqual(result.projects[1], { src: 'project-b', description: 'Updated Project B' });
    assert.deepEqual(result.projects[2], { src: 'project-c', description: 'Project C' });
  });

  test('concats and dedupes checks array by name', () => {
    const base = {
      checks: [
        { name: 'check-a', test: 'echo a' },
        { name: 'check-b', test: 'echo b' }
      ]
    };
    const override = {
      checks: [
        { name: 'check-b', test: 'echo b-updated' },
        { name: 'check-c', test: 'echo c' }
      ]
    };
    const result = deepMergeConfigs(base, override) as { checks: Array<{ name: string; test: string }> };

    assert.equal(result.checks.length, 3);
    assert.equal(result.checks[0].name, 'check-a');
    assert.equal(result.checks[1].name, 'check-b');
    assert.equal(result.checks[1].test, 'echo b-updated');
    assert.equal(result.checks[2].name, 'check-c');
  });

  test('concats and dedupes env array by name', () => {
    const base = {
      env: [
        { name: 'VAR_A', default: 'a' },
        { name: 'VAR_B', default: 'b' }
      ]
    };
    const override = {
      env: [
        { name: 'VAR_B', default: 'b-updated' },
        { name: 'VAR_C', default: 'c' }
      ]
    };
    const result = deepMergeConfigs(base, override) as { env: Array<{ name: string; default: string }> };

    assert.equal(result.env.length, 3);
    assert.equal(result.env[0].name, 'VAR_A');
    assert.equal(result.env[1].name, 'VAR_B');
    assert.equal(result.env[1].default, 'b-updated');
    assert.equal(result.env[2].name, 'VAR_C');
  });

  test('primitives are overridden', () => {
    const base = { version: '0.1.0', devduck_path: './old' };
    const override = { devduck_path: './new' };
    const result = deepMergeConfigs(base, override);

    assert.equal(result.version, '0.1.0');
    assert.equal(result.devduck_path, './new');
  });

  test('merges taskfile section', () => {
    const base = {
      taskfile: {
        vars: { CACHE_DIR: '.cache', ARTIFACTS_DIR: '.cache/artifacts' },
        tasks: {
          install: { desc: 'Base install', cmds: [{ task: 'install:1' }] }
        }
      }
    };
    const override = {
      taskfile: {
        vars: { CACHE_DIR: '.cache/custom' },
        tasks: {
          'custom-task': { desc: 'Custom task', cmds: ['echo custom'] }
        }
      }
    };
    const result = deepMergeConfigs(base, override) as {
      taskfile: {
        vars: Record<string, string>;
        tasks: Record<string, { desc: string }>;
      };
    };

    // Vars should be merged
    assert.equal(result.taskfile.vars.CACHE_DIR, '.cache/custom');
    assert.equal(result.taskfile.vars.ARTIFACTS_DIR, '.cache/artifacts');

    // Tasks should be merged (both present)
    assert.ok(result.taskfile.tasks.install);
    assert.ok(result.taskfile.tasks['custom-task']);
  });
});

describe('loadConfigWithExtends', () => {
  test('loads simple config without extends', () => {
    const configPath = path.join(tmpDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify({
      version: '0.1.0',
      modules: ['core', 'cursor']
    }));

    const result = loadConfigWithExtends(configPath, tmpDir);
    assert.ok(result);
    assert.equal(result.version, '0.1.0');
    assert.deepEqual(result.modules, ['core', 'cursor']);
  });

  test('resolves single extends', () => {
    // Create base config
    const baseDir = path.join(tmpDir, 'base');
    fs.mkdirSync(baseDir, { recursive: true });
    const basePath = path.join(baseDir, 'base.yml');
    fs.writeFileSync(basePath, YAML.stringify({
      version: '0.1.0',
      taskfile: {
        vars: { CACHE_DIR: '.cache' },
        tasks: { install: { desc: 'Install', cmds: ['echo install'] } }
      }
    }));

    // Create main config that extends base
    const configPath = path.join(tmpDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify({
      extends: ['./base/base.yml'],
      modules: ['core']
    }));

    const result = loadConfigWithExtends(configPath, tmpDir);
    assert.ok(result);
    assert.equal(result.version, '0.1.0');
    assert.deepEqual(result.modules, ['core']);
    const taskfile = result.taskfile as { vars: Record<string, string> };
    assert.equal(taskfile.vars.CACHE_DIR, '.cache');
  });

  test('resolves chained extends (base -> mid -> main)', () => {
    // Create base config
    const basePath = path.join(tmpDir, 'base.yml');
    fs.writeFileSync(basePath, YAML.stringify({
      version: '0.1.0',
      env: [{ name: 'BASE_VAR', default: 'base' }]
    }));

    // Create mid config that extends base
    const midPath = path.join(tmpDir, 'mid.yml');
    fs.writeFileSync(midPath, YAML.stringify({
      extends: ['./base.yml'],
      env: [{ name: 'MID_VAR', default: 'mid' }]
    }));

    // Create main config that extends mid
    const configPath = path.join(tmpDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify({
      extends: ['./mid.yml'],
      env: [{ name: 'MAIN_VAR', default: 'main' }]
    }));

    const result = loadConfigWithExtends(configPath, tmpDir);
    assert.ok(result);
    const env = result.env as Array<{ name: string; default: string }>;
    assert.equal(env.length, 3);
    assert.ok(env.find(e => e.name === 'BASE_VAR'));
    assert.ok(env.find(e => e.name === 'MID_VAR'));
    assert.ok(env.find(e => e.name === 'MAIN_VAR'));
  });

  test('detects circular extends', () => {
    // Create config A that extends B
    const configAPath = path.join(tmpDir, 'config-a.yml');
    const configBPath = path.join(tmpDir, 'config-b.yml');

    fs.writeFileSync(configAPath, YAML.stringify({
      extends: ['./config-b.yml'],
      version: '0.1.0'
    }));

    fs.writeFileSync(configBPath, YAML.stringify({
      extends: ['./config-a.yml'],
      modules: ['core']
    }));

    assert.throws(
      () => loadConfigWithExtends(configAPath, tmpDir),
      /Circular extends detected/
    );
  });

  test('throws error for missing extended file', () => {
    const configPath = path.join(tmpDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify({
      extends: ['./nonexistent.yml'],
      version: '0.1.0'
    }));

    assert.throws(
      () => loadConfigWithExtends(configPath, tmpDir),
      /Extended config not found/
    );
  });

  test('resolves devduck: paths', () => {
    // Create devduck defaults
    const devduckDir = path.join(tmpDir, 'devduck');
    const defaultsDir = path.join(devduckDir, 'defaults');
    fs.mkdirSync(defaultsDir, { recursive: true });
    fs.writeFileSync(path.join(defaultsDir, 'install.yml'), YAML.stringify({
      taskfile: {
        vars: { CACHE_DIR: '.cache' },
        tasks: { install: { desc: 'Install', cmds: ['echo install'] } }
      }
    }));

    // Create main config that extends devduck:defaults/install.yml
    const configPath = path.join(tmpDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify({
      devduck_path: './devduck',
      extends: ['devduck:defaults/install.yml'],
      version: '0.1.0',
      modules: ['core']
    }));

    const result = loadConfigWithExtends(configPath, tmpDir);
    assert.ok(result);
    const taskfile = result.taskfile as { vars: Record<string, string> };
    assert.equal(taskfile.vars.CACHE_DIR, '.cache');
    assert.deepEqual(result.modules, ['core']);
  });

  test('later extends override earlier ones', () => {
    // Create two base configs
    fs.writeFileSync(path.join(tmpDir, 'base1.yml'), YAML.stringify({
      version: '0.1.0',
      taskfile: { vars: { VAR: 'base1' } }
    }));
    fs.writeFileSync(path.join(tmpDir, 'base2.yml'), YAML.stringify({
      taskfile: { vars: { VAR: 'base2' } }
    }));

    // Main config extends both (base2 should win for conflicts)
    const configPath = path.join(tmpDir, 'workspace.config.yml');
    fs.writeFileSync(configPath, YAML.stringify({
      extends: ['./base1.yml', './base2.yml'],
      modules: ['core']
    }));

    const result = loadConfigWithExtends(configPath, tmpDir);
    assert.ok(result);
    const taskfile = result.taskfile as { vars: Record<string, string> };
    assert.equal(taskfile.vars.VAR, 'base2');
  });
});

describe('readMergedWorkspaceConfig', () => {
  test('reads and merges workspace config with extends', () => {
    // Create base config in devduck defaults
    const devduckDir = path.join(tmpDir, 'devduck', 'defaults');
    fs.mkdirSync(devduckDir, { recursive: true });
    fs.writeFileSync(path.join(devduckDir, 'workspace.install.yml'), YAML.stringify({
      version: '0.1.0',
      taskfile: {
        vars: { CACHE_DIR: '.cache', ARTIFACTS_DIR: '.cache/artifacts' },
        tasks: {
          install: { desc: 'Run install', cmds: [{ task: 'install:1' }] },
          'install:1': { desc: 'Step 1', cmds: ['echo step1'] }
        }
      }
    }));

    // Create workspace config
    fs.writeFileSync(path.join(tmpDir, 'workspace.config.yml'), YAML.stringify({
      devduck_path: './devduck',
      extends: ['devduck:defaults/workspace.install.yml'],
      modules: ['core', 'cursor']
    }));

    const { config, configFile } = readMergedWorkspaceConfig(tmpDir);
    assert.ok(config);
    assert.ok(configFile.endsWith('workspace.config.yml'));
    assert.deepEqual(config.modules, ['core', 'cursor']);

    const taskfile = config.taskfile as { vars: Record<string, string>; tasks: Record<string, unknown> };
    assert.equal(taskfile.vars.CACHE_DIR, '.cache');
    assert.ok(taskfile.tasks.install);
    assert.ok(taskfile.tasks['install:1']);
  });

  test('returns null for missing workspace config', () => {
    const { config, configFile } = readMergedWorkspaceConfig(tmpDir);
    assert.equal(config, null);
    assert.ok(configFile.endsWith('workspace.config.yml'));
  });
});
