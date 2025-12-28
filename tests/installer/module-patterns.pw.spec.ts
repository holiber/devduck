import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { getAllModules, resolveModules } from '../../scripts/install/module-resolver.js';
import YAML from 'yaml';

async function readYaml(p: string): Promise<any> {
  const raw = await fs.readFile(p, 'utf8');
  return YAML.parse(raw);
}

test.describe('workspace modules patterns', () => {
  test('modules: ["issue-*"] expands to issue-tracker and issue-tracker-github', async () => {
    const fixtureConfigPath = path.join(
      process.cwd(),
      'tests',
      'workspace-fixtures',
      'modules-issue-star',
      'workspace.config.yml'
    );

    const cfg = await readYaml(fixtureConfigPath);
    assert.deepStrictEqual(cfg.modules, ['issue-*'], 'fixture should keep the pattern in modules[]');

    const all = getAllModules();
    const resolved = resolveModules(cfg, all).map((m) => m.name);

    assert.ok(resolved.includes('issue-tracker'), 'issue-tracker should be resolved from issue-*');
    assert.ok(
      resolved.includes('issue-tracker-github'),
      'issue-tracker-github should be resolved from issue-*'
    );
  });
});

