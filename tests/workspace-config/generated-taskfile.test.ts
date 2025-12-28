import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

function writeYaml(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = YAML.stringify(data);
  fs.writeFileSync(p, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

test('devduck sync generates .cache/taskfile.generated.yml from merged config.taskfile', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devduck-taskfile-gen-'));
  try {
    const repoRoot = process.cwd();
    const cliPath = path.join(repoRoot, 'scripts', 'devduck-cli.ts');

    // Create a minimal "devduck root" inside the temp workspace so `devduck:` references work.
    const devduckRoot = path.join(tmp, 'devduck', 'src');
    writeYaml(path.join(devduckRoot, 'defaults', 'workspace.install.yml'), {
      version: '0.1.0',
      taskfile: {
        vars: { CACHE_DIR: '.cache', CUSTOM_VAR: 'from-baseline' },
        tasks: {
          'custom:ping': {
            desc: 'Unique task coming from baseline layer',
            cmds: ['echo ping']
          }
        }
      }
    });

    // Workspace config extends baseline and adds an override layer.
    writeYaml(path.join(tmp, 'layer.yml'), {
      taskfile: {
        vars: { CUSTOM_VAR: 'from-layer' },
        tasks: {
          'custom:pong': { cmds: ['echo pong'] }
        }
      }
    });

    writeYaml(path.join(tmp, 'workspace.config.yml'), {
      version: '0.1.0',
      devduck_path: './devduck/src',
      extends: ['devduck:defaults/workspace.install.yml', './layer.yml']
    });

    const res = spawnSync('npx', ['tsx', cliPath, 'sync', tmp], {
      encoding: 'utf8',
      env: { ...process.env }
    });
    assert.equal(res.status, 0, `sync failed (exit ${res.status})\n${res.stderr}\n${res.stdout}`);

    const generatedPath = path.join(tmp, '.cache', 'taskfile.generated.yml');
    assert.ok(fs.existsSync(generatedPath), 'generated taskfile exists');

    const parsed = YAML.parse(fs.readFileSync(generatedPath, 'utf8')) as any;
    assert.equal(parsed.version, '3');
    assert.equal(parsed.output, 'interleaved');

    // Proves generation used merged config.taskfile (fallback hardcoded tasks don't have these).
    assert.ok(parsed.tasks?.['custom:ping'], 'custom:ping exists');
    assert.ok(parsed.tasks?.['custom:pong'], 'custom:pong exists');

    // Vars should include baseline+layer plus required injected vars.
    assert.equal(parsed.vars?.CUSTOM_VAR, 'from-layer');
    assert.equal(parsed.vars?.CACHE_DIR, '.cache');
    assert.equal(parsed.vars?.DEVDUCK_ROOT, './devduck/src');
    assert.equal(parsed.vars?.WORKSPACE_ROOT, '{{ default "." .WORKSPACE_ROOT }}');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

