
import { test, expect } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import { getAllModules, resolveModules } from '../../scripts/install/module-resolver.js';

async function readJson(p: string): Promise<any> {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

test.describe('workspace modules patterns', () => {
  test('modules: ["issue-*"] expands to issue-tracker and issue-tracker-github', async () => {
    const fixtureConfigPath = path.join(
      process.cwd(),
      'tests',
      'workspace-fixtures',
      'modules-issue-star',
      'workspace.config.json'
    );

    const cfg = await readJson(fixtureConfigPath);
    expect(cfg.modules, 'fixture should keep the pattern in modules[]').toEqual(['issue-*']);

    const all = getAllModules();
    const resolved = resolveModules(cfg, all).map((m) => m.name);

    expect(resolved.includes('issue-tracker'), 'issue-tracker should be resolved from issue-*').toBeTruthy();
    expect(
      resolved.includes('issue-tracker-github'),
      'issue-tracker-github should be resolved from issue-*'
    ).toBeTruthy();
  });
});
