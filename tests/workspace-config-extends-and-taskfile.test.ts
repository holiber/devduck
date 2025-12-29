import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { readWorkspaceConfigFromRoot } from '../src/lib/workspace-config.js';

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeYaml(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf8');
}

test('workspace.config.yml supports extends (devduck:) with concat+dedupe merge', () => {
  const repoRoot = process.cwd(); // projects/devduck
  const wsRoot = mkTmpDir('devduck-ws-extends-');

  const basePath = path.join(wsRoot, 'base.yml');
  writeYaml(basePath, {
    version: '0.1.0',
    projects: [
      { src: 'github.com/example/foo', description: 'from-base' },
      { src: 'github.com/example/base-only', description: 'base-only' }
    ],
    checks: [{ name: 'check1', test: 'echo base' }],
    env: [{ name: 'FOO', default: 'base' }]
  });

  const wsConfigPath = path.join(wsRoot, 'workspace.config.yml');
  writeYaml(wsConfigPath, {
    version: '0.1.0',
    devduck_path: repoRoot,
    extends: ['./base.yml', 'devduck:defaults/workspace.install.yml'],
    projects: [{ src: 'github.com/example/foo', description: 'from-workspace' }],
    checks: [{ name: 'check1', test: 'echo workspace' }],
    env: [{ name: 'FOO', default: 'workspace' }]
  });

  const { config } = readWorkspaceConfigFromRoot<Record<string, unknown>>(wsRoot);
  assert.ok(config, 'resolved config should exist');

  // Baseline taskfile should be present after extends.
  const taskfile = (config as any).taskfile;
  assert.ok(taskfile, 'taskfile section should be present via baseline extends');
  assert.ok(taskfile.tasks, 'taskfile.tasks should exist');
  assert.ok(taskfile.tasks.install, 'taskfile.tasks.install should exist');

  // Dedupe by src: workspace overrides base.
  const projects = ((config as any).projects ?? []) as Array<{ src?: string; description?: string }>;
  const foo = projects.find((p) => p.src === 'github.com/example/foo');
  assert.equal(foo?.description, 'from-workspace');
  assert.ok(projects.find((p) => p.src === 'github.com/example/base-only'));

  // Dedupe by name: workspace overrides base.
  const checks = ((config as any).checks ?? []) as Array<{ name?: string; test?: string }>;
  const check1 = checks.find((c) => c.name === 'check1');
  assert.equal(check1?.test, 'echo workspace');

  // Dedupe by name: workspace overrides base.
  const env = ((config as any).env ?? []) as Array<{ name?: string; default?: string }>;
  const fooEnv = env.find((e) => e.name === 'FOO');
  assert.equal(fooEnv?.default, 'workspace');
});

test('devduck-cli sync generates .cache/taskfile.generated.yml from merged config.taskfile', () => {
  const repoRoot = process.cwd(); // projects/devduck
  const wsRoot = mkTmpDir('devduck-ws-taskfile-');

  writeYaml(path.join(wsRoot, 'workspace.config.yml'), {
    version: '0.1.0',
    devduck_path: repoRoot,
    extends: ['devduck:defaults/workspace.install.yml']
  });

  const cliPath = path.join(repoRoot, 'scripts', 'barducks-cli.ts');
  const res = spawnSync('npx', ['tsx', cliPath, 'sync', wsRoot], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: 'utf8'
  });
  assert.equal(res.status, 0, `sync failed\n${res.stderr}\n${res.stdout}`);

  const generatedPath = path.join(wsRoot, '.cache', 'taskfile.generated.yml');
  assert.ok(fs.existsSync(generatedPath), 'generated taskfile should exist');

  const parsed = YAML.parse(fs.readFileSync(generatedPath, 'utf8')) as any;
  assert.equal(parsed.version, '3');
  assert.ok(parsed.tasks?.install, 'tasks.install should exist');
  assert.ok(parsed.tasks?.['install:1-check-env'], 'tasks.install:1-check-env should exist');

  // Vars injected by generator.
  assert.equal(parsed.vars?.DEVDUCK_ROOT, repoRoot);
  assert.ok(typeof parsed.vars?.WORKSPACE_ROOT === 'string' && parsed.vars.WORKSPACE_ROOT.includes('default'));

  // Baseline command comes from config.taskfile.
  const cmd0 = parsed.tasks['install:1-check-env']?.cmds?.[0];
  assert.ok(typeof cmd0 === 'string' && cmd0.includes('run-step.ts check-env'));
});

test('extends cycle is detected and reported', () => {
  const repoRoot = process.cwd(); // projects/devduck
  const wsRoot = mkTmpDir('devduck-ws-cycle-');

  writeYaml(path.join(wsRoot, 'a.yml'), { version: '0.1.0', extends: ['./b.yml'] });
  writeYaml(path.join(wsRoot, 'b.yml'), { version: '0.1.0', extends: ['./a.yml'] });
  writeYaml(path.join(wsRoot, 'workspace.config.yml'), {
    version: '0.1.0',
    devduck_path: repoRoot,
    extends: ['./a.yml']
  });

  assert.throws(() => readWorkspaceConfigFromRoot(wsRoot), /cycle/i);
});

