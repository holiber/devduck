#!/usr/bin/env node

/**
 * Tests for workspace.config.json module patterns (e.g. "issue-*").
 * Migrated to Playwright Test
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';

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
    expect(cfg.modules).toEqual(['issue-*']);

    const all = getAllModules();
    const resolved = resolveModules(cfg, all).map((m) => m.name);

    expect(resolved).toContain('issue-tracker');
    expect(resolved).toContain('issue-tracker-github');
  });
});
