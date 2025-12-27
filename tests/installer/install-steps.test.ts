#!/usr/bin/env node

/**
 * Tests for the 7-step installation pipeline.
 *
 * These tests intentionally avoid requiring real external credentials:
 * - required env vars are satisfied with deterministic dummy values
 * - optional verification checks may fail but must not break the pipeline
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { createTempWorkspace, cleanupTempWorkspace } from './helpers.js';

import { readJSON } from '../../scripts/lib/config.js';
import { setupEnvFile } from '../../scripts/install/env.js';
import { readInstallState, updateInstallStep, writeInstallState } from '../../scripts/install/install-state.js';

import { installStep1CheckEnv } from '../../scripts/install/install-1-check-env.js';
import { installStep2DownloadRepos } from '../../scripts/install/install-2-download-repos.js';
import { installStep3DownloadProjects } from '../../scripts/install/install-3-download-projects.js';
import { installStep4CheckEnvAgain } from '../../scripts/install/install-4-check-env-again.js';
import { installStep5SetupModules } from '../../scripts/install/install-5-setup-modules.js';
import { installStep6SetupProjects } from '../../scripts/install/install-6-setup-projects.js';
import { installStep7VerifyInstallation } from '../../scripts/install/install-7-verify-installation.js';

describe('Installation Steps', () => {
  let tempWorkspace: string;

  const log = (_msg: string) => {
    // keep test output clean
  };

  before(async () => {
    tempWorkspace = await createTempWorkspace('devduck-install-steps-');

    // Seed minimal workspace.config.json.
    const config = {
      workspaceVersion: '0.1.0',
      devduckPath: './projects/devduck',
      modules: ['core', 'cursor'],
      moduleSettings: {},
      repos: [],
      projects: [],
      checks: [],
      env: []
    };
    await fs.writeFile(path.join(tempWorkspace, 'workspace.config.json'), JSON.stringify(config, null, 2), 'utf8');

    // Provide required tokens used by built-in modules.
    process.env.CURSOR_API_KEY = process.env.CURSOR_API_KEY || 'test-cursor-api-key';

    // Ensure .env exists (step 1 reads it).
    const cfg = readJSON(path.join(tempWorkspace, 'workspace.config.json'));
    await setupEnvFile(tempWorkspace, cfg as any, { autoYes: true, log, print: () => {}, symbols: { info: 'ℹ', success: '✓', warning: '⚠', error: '✗', search: '🔍', check: '✅', file: '📝', log: '📋' } as any });

    // Ensure install-state exists.
    await fs.mkdir(path.join(tempWorkspace, '.cache'), { recursive: true });
    writeInstallState(tempWorkspace, readInstallState(tempWorkspace));
  });

  after(async () => {
    if (tempWorkspace) await cleanupTempWorkspace(tempWorkspace);
  });

  async function getConfig() {
    const cfg = readJSON(path.join(tempWorkspace, 'workspace.config.json'));
    return cfg as any;
  }

  async function ensureCompleted(stepKey: any, runner: () => Promise<void>) {
    const state = readInstallState(tempWorkspace);
    if (state.steps[stepKey]?.completed) return;
    await runner();
  }

  test('Step 1: Check Environment', async () => {
    const config = await getConfig();
    const res = await installStep1CheckEnv({ workspaceRoot: tempWorkspace, config, log });
    updateInstallStep(tempWorkspace, 'check-env', { completed: res.ok, result: res.result });
    assert.ok(res.ok, 'step 1 should succeed with dummy env vars');
  });

  test('Step 2: Download Repos', async () => {
    await ensureCompleted('check-env', async () => {
      const config = await getConfig();
      const r = await installStep1CheckEnv({ workspaceRoot: tempWorkspace, config, log });
      updateInstallStep(tempWorkspace, 'check-env', { completed: r.ok, result: r.result });
      assert.ok(r.ok);
    });

    const config = await getConfig();
    const res = await installStep2DownloadRepos({ workspaceRoot: tempWorkspace, config, log });
    updateInstallStep(tempWorkspace, 'download-repos', { completed: res.ok, result: { repos: res.repos } });
    assert.ok(res.ok, 'step 2 should succeed when no repos configured');
  });

  test('Step 3: Download Projects', async () => {
    await ensureCompleted('download-repos', async () => {
      const config = await getConfig();
      const r = await installStep2DownloadRepos({ workspaceRoot: tempWorkspace, config, log });
      updateInstallStep(tempWorkspace, 'download-repos', { completed: r.ok, result: { repos: r.repos } });
      assert.ok(r.ok);
    });

    const config = await getConfig();
    const res = await installStep3DownloadProjects({ workspaceRoot: tempWorkspace, config, log });
    updateInstallStep(tempWorkspace, 'download-projects', { completed: res.ok, result: { projects: res.projects } });
    assert.ok(res.ok, 'step 3 should succeed when no projects configured');
  });

  test('Step 4: Check Environment Again', async () => {
    await ensureCompleted('download-projects', async () => {
      const config = await getConfig();
      const r = await installStep3DownloadProjects({ workspaceRoot: tempWorkspace, config, log });
      updateInstallStep(tempWorkspace, 'download-projects', { completed: r.ok, result: { projects: r.projects } });
      assert.ok(r.ok);
    });

    const config = await getConfig();
    const res = await installStep4CheckEnvAgain({ workspaceRoot: tempWorkspace, config, log });
    updateInstallStep(tempWorkspace, 'check-env-again', { completed: res.ok, result: res.result });
    assert.ok(res.ok, 'step 4 should succeed with dummy env vars');
  });

  test('Step 5: Setup Modules', async () => {
    await ensureCompleted('check-env-again', async () => {
      const config = await getConfig();
      const r = await installStep4CheckEnvAgain({ workspaceRoot: tempWorkspace, config, log });
      updateInstallStep(tempWorkspace, 'check-env-again', { completed: r.ok, result: r.result });
      assert.ok(r.ok);
    });

    const config = await getConfig();
    const res = await installStep5SetupModules({ workspaceRoot: tempWorkspace, config, autoYes: true, log });
    updateInstallStep(tempWorkspace, 'setup-modules', { completed: res.ok, result: res.result });

    // Hooks are required; checks may include optional failures.
    assert.ok(res.result.installedModules.git, 'git module should be recorded');
    assert.ok(res.result.installedModules.cursor, 'cursor module should be recorded');
  });

  test('Step 6: Setup Projects', async () => {
    await ensureCompleted('setup-modules', async () => {
      const config = await getConfig();
      const r = await installStep5SetupModules({ workspaceRoot: tempWorkspace, config, autoYes: true, log });
      updateInstallStep(tempWorkspace, 'setup-modules', { completed: r.ok, result: r.result });
    });

    const config = await getConfig();
    const res = await installStep6SetupProjects({ workspaceRoot: tempWorkspace, config, autoYes: true, log });
    updateInstallStep(tempWorkspace, 'setup-projects', { completed: res.ok, result: res.result });
    assert.ok(res.ok, 'step 6 should succeed when no project checks configured');
  });

  test('Step 7: Verify Installation', async () => {
    await ensureCompleted('setup-projects', async () => {
      const config = await getConfig();
      const r = await installStep6SetupProjects({ workspaceRoot: tempWorkspace, config, autoYes: true, log });
      updateInstallStep(tempWorkspace, 'setup-projects', { completed: r.ok, result: r.result });
      assert.ok(r.ok);
    });

    const config = await getConfig();
    const res = await installStep7VerifyInstallation({ workspaceRoot: tempWorkspace, config, log });
    updateInstallStep(tempWorkspace, 'verify-installation', { completed: res.ok, result: res.result });

    // Required checks must pass (e.g. CURSOR_API_KEY presence); optional probes may fail.
    assert.ok(res.ok, 'step 7 should succeed when only optional checks fail');
  });
});

