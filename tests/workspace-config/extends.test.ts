import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { readWorkspaceConfigFromRoot } from '../../scripts/lib/workspace-config.js';

function writeYaml(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = YAML.stringify(data);
  fs.writeFileSync(p, out.endsWith('\n') ? out : out + '\n', 'utf8');
}

test('workspace config extends: deep-merge and concat+dedupe arrays', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devduck-workspace-config-extends-'));
  try {
    const devduckRoot = path.join(tmp, 'devduck', 'src');
    const baseline = path.join(devduckRoot, 'defaults', 'workspace.install.yml');
    writeYaml(baseline, {
      version: '0.1.0',
      projects: [{ src: 'A', value: 1 }],
      checks: [{ name: 'c1', test: 'echo base' }],
      env: [{ name: 'VAR', default: 'base' }],
      nested: { obj: { a: 1, b: { c: 1 } } },
      arr: [1, 2]
    });

    const layer2 = path.join(tmp, 'layer2.yml');
    writeYaml(layer2, {
      projects: [{ src: 'A', value: 2 }, { src: 'B', value: 3 }],
      checks: [{ name: 'c1', test: 'echo override' }],
      env: [{ name: 'VAR', default: 'override' }],
      nested: { obj: { b: { d: 2 } } },
      arr: [2, 3]
    });

    const entry = path.join(tmp, 'workspace.config.yml');
    writeYaml(entry, {
      version: '0.1.0',
      devduck_path: './devduck/src',
      extends: ['devduck:defaults/workspace.install.yml', './layer2.yml']
    });

    const { config } = readWorkspaceConfigFromRoot<Record<string, unknown>>(tmp);
    assert.ok(config);

    const projects = (config as { projects?: unknown }).projects as Array<{ src: string; value: number }>;
    const bySrc = Object.fromEntries(projects.map((p) => [p.src, p.value]));
    assert.deepEqual(bySrc, { A: 2, B: 3 });

    const checks = (config as { checks?: unknown }).checks as Array<{ name: string; test: string }>;
    assert.deepEqual(checks.map((c) => [c.name, c.test]), [['c1', 'echo override']]);

    const env = (config as { env?: unknown }).env as Array<{ name: string; default: string }>;
    assert.deepEqual(env.map((e) => [e.name, e.default]), [['VAR', 'override']]);

    assert.deepEqual((config as any).nested.obj, { a: 1, b: { c: 1, d: 2 } });
    assert.deepEqual((config as any).arr, [1, 2, 3]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('workspace config extends: detects cycles with a helpful error', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devduck-workspace-config-cycle-'));
  try {
    writeYaml(path.join(tmp, 'A.yml'), { extends: ['./B.yml'], a: 1 });
    writeYaml(path.join(tmp, 'B.yml'), { extends: ['./A.yml'], b: 1 });
    writeYaml(path.join(tmp, 'workspace.config.yml'), { version: '0.1.0', extends: ['./A.yml'] });

    assert.throws(
      () => readWorkspaceConfigFromRoot(tmp),
      (err) => {
        const msg = String((err as Error).message || err);
        return msg.includes('extends cycle detected') && msg.includes('A.yml') && msg.includes('B.yml');
      }
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

