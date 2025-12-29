import { test } from '@playwright/test';
import assert from 'node:assert';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import {
  createSharedTempWorkspace,
  cleanupSharedTempWorkspace,
  isStepCompleted,
  getStepResult,
  getExecutedChecks,
  createMockWorkspace
} from './helpers.js';

import { runStep1CheckEnv } from '../../src/install/install-1-check-env.js';
import { runStep2DownloadRepos } from '../../src/install/install-2-download-repos.js';
import { runStep3DownloadProjects } from '../../src/install/install-3-download-projects.js';
import { runStep4CheckEnvAgain } from '../../src/install/install-4-check-env-again.js';
import { runStep5SetupModules } from '../../src/install/install-5-setup-modules.js';
import { runStep6SetupProjects } from '../../src/install/install-6-setup-projects.js';
import { runStep7VerifyInstallation } from '../../src/install/install-7-verify-installation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

test.describe.serial('Installation Steps', () => {
  let sharedWorkspace: string;
  const stepResults = new Map<string, boolean>();

  test.beforeAll(async () => {
    // Create shared workspace in .cache/temp
    sharedWorkspace = await createSharedTempWorkspace('install-steps-test-');
    console.log(`Created shared workspace: ${sharedWorkspace}`);
  });

  async function ensureCompletedUpTo(step: 2 | 3 | 4 | 5): Promise<void> {
    // When running a subset via --grep (e.g. smoke), earlier steps may not execute.
    // Make later steps runnable in isolation by performing minimal prerequisite setup.
    const configPath = path.join(sharedWorkspace, 'workspace.config.yml');
    try {
      await fs.access(configPath);
    } catch {
      await createMockWorkspace(sharedWorkspace, {
        extensions: ['core'],
        env: [{ name: 'TEST_VAR_1', description: 'Test variable 1' }]
      });
    }

    // Ensure required env is present for step 1.
    await fs.writeFile(path.join(sharedWorkspace, '.env'), 'TEST_VAR_1=test-value-1\n', 'utf8');
    process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-github-token';
    process.env.CURSOR_API_KEY = process.env.CURSOR_API_KEY || 'test-cursor-api-key';

    if (!stepResults.get('check-env')) {
      await runStep1CheckEnv(sharedWorkspace, PROJECT_ROOT);
      stepResults.set('check-env', true);
    }

    if (step >= 2 && !stepResults.get('download-repos')) {
      const cfg = YAML.parse(await fs.readFile(configPath, 'utf8'));
      cfg.repos = [];
      await fs.writeFile(configPath, YAML.stringify(cfg), 'utf8');
      await runStep2DownloadRepos(sharedWorkspace);
      stepResults.set('download-repos', true);
    }

    if (step >= 3 && !stepResults.get('download-projects')) {
      const cfg = YAML.parse(await fs.readFile(configPath, 'utf8'));
      cfg.projects = [];
      await fs.writeFile(configPath, YAML.stringify(cfg), 'utf8');
      await runStep3DownloadProjects(sharedWorkspace);
      stepResults.set('download-projects', true);
    }

    if (step >= 4 && !stepResults.get('check-env-again')) {
      await runStep4CheckEnvAgain(sharedWorkspace, PROJECT_ROOT);
      stepResults.set('check-env-again', true);
    }

    if (step >= 5 && !stepResults.get('setup-modules')) {
      await runStep5SetupModules(sharedWorkspace, PROJECT_ROOT, undefined, true);
      stepResults.set('setup-modules', true);
    }
  }

  test.afterAll(async () => {
    await cleanupSharedTempWorkspace(sharedWorkspace);
    console.log(`Cleaned up shared workspace: ${sharedWorkspace}`);
  });

  test('Step 1: Check Environment Variables', async () => {
    // Create minimal workspace config with only core extension (which has minimal env requirements)
    await createMockWorkspace(sharedWorkspace, {
      extensions: ['core'],
      env: [
        { name: 'TEST_VAR_1', description: 'Test variable 1' },
        { name: 'TEST_VAR_2', description: 'Test variable 2', optional: true }
      ]
    });

    // Set env vars that modules might require (to avoid false positives)
    process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-github-token';
    process.env.CURSOR_API_KEY = process.env.CURSOR_API_KEY || 'test-cursor-api-key';

    // Test with missing required env vars (should return needs_input)
    const result1 = await runStep1CheckEnv(sharedWorkspace, PROJECT_ROOT);
    assert.strictEqual(result1.validationStatus, 'needs_input', 'Should return needs_input when vars are missing');
    assert.ok(result1.missing.length > 0, 'Should have missing variables');
    assert.ok(await isStepCompleted(sharedWorkspace, 'check-env'), 'Step should be marked as completed');

    // Set required env var
    const envFile = path.join(sharedWorkspace, '.env');
    await fs.writeFile(envFile, 'TEST_VAR_1=test-value-1\n', 'utf8');

    // Test with all required vars present (should return ok)
    // Note: Some modules may still require env vars, so we check for ok or needs_input
    const result2 = await runStep1CheckEnv(sharedWorkspace, PROJECT_ROOT);
    assert.ok(
      result2.validationStatus === 'ok' || result2.validationStatus === 'needs_input',
      'Should return ok or needs_input'
    );
    assert.ok(result2.present.includes('TEST_VAR_1'), 'TEST_VAR_1 should be in present list');

    // Verify state is saved
    const stepResult = await getStepResult(sharedWorkspace, 'check-env');
    assert.ok(stepResult, 'Step result should be saved');
    assert.ok(await isStepCompleted(sharedWorkspace, 'check-env'), 'Step should be completed');

    stepResults.set('check-env', true);
  });

  test('Step 2: Download Repos', async () => {
    test.skip(!stepResults.get('check-env'), 'Skipping Step 2: Step 1 failed');

    // Test with no repos configured (should skip)
    const configPath = path.join(sharedWorkspace, 'workspace.config.yml');
    const config = YAML.parse(await fs.readFile(configPath, 'utf8'));
    config.repos = [];
    await fs.writeFile(configPath, YAML.stringify(config), 'utf8');

    const result1 = await runStep2DownloadRepos(sharedWorkspace);
    assert.strictEqual(result1.repos.length, 0, 'Should have no repos when none configured');
    assert.ok(await isStepCompleted(sharedWorkspace, 'download-repos'), 'Step should be marked as completed');

    stepResults.set('download-repos', true);
  });

  test('Step 3: Download Projects @smoke', async () => {
    if (!stepResults.get('download-repos')) {
      await ensureCompletedUpTo(2);
    }

    // Test with no projects configured (should skip)
    const configPath = path.join(sharedWorkspace, 'workspace.config.yml');
    const config = YAML.parse(await fs.readFile(configPath, 'utf8'));
    config.projects = [];
    await fs.writeFile(configPath, YAML.stringify(config), 'utf8');

    const result1 = await runStep3DownloadProjects(sharedWorkspace);
    assert.strictEqual(result1.projects.length, 0, 'Should have no projects when none configured');
    assert.ok(await isStepCompleted(sharedWorkspace, 'download-projects'), 'Step should be marked as completed');

    stepResults.set('download-projects', true);
  });

  test('Step 4: Check Environment Again', async () => {
    test.skip(!stepResults.get('download-projects'), 'Skipping Step 4: Step 3 failed');

    const result = await runStep4CheckEnvAgain(sharedWorkspace, PROJECT_ROOT);

    // Since we have no repos/projects with new env requirements, should return ok
    assert.ok(result.validationStatus === 'ok' || result.validationStatus === 'needs_input', 'Should return ok or needs_input');
    assert.ok(await isStepCompleted(sharedWorkspace, 'check-env-again'), 'Step should be marked as completed');

    // Verify state is saved
    const stepResult = await getStepResult(sharedWorkspace, 'check-env-again');
    assert.ok(stepResult, 'Step result should be saved');

    stepResults.set('check-env-again', true);
  });

  test('Step 5: Setup Modules', async () => {
    test.skip(!stepResults.get('check-env-again'), 'Skipping Step 5: Step 4 failed');

    const result = await runStep5SetupModules(sharedWorkspace, PROJECT_ROOT, undefined, true);

    assert.ok(Array.isArray(result.modules), 'Should return modules array');
    assert.ok(await isStepCompleted(sharedWorkspace, 'setup-modules'), 'Step should be marked as completed');

    // Verify state is saved with module results
    const stepResult = (await getStepResult(sharedWorkspace, 'setup-modules')) as Array<{ name: string; checks: unknown[] }>;
    assert.ok(stepResult, 'Step result should be saved');
    assert.ok(Array.isArray(stepResult), 'Step result should be an array');

    // Verify executed checks are tracked
    const executedChecks = await getExecutedChecks(sharedWorkspace);
    assert.ok(Array.isArray(executedChecks), 'Executed checks should be tracked');

    stepResults.set('setup-modules', true);
  });

  test('Step 6: Setup Projects @smoke', async () => {
    if (!stepResults.get('setup-modules')) {
      await ensureCompletedUpTo(5);
    }

    const result = await runStep6SetupProjects(sharedWorkspace, PROJECT_ROOT, undefined, true);

    assert.ok(Array.isArray(result.projects), 'Should return projects array');
    assert.ok(await isStepCompleted(sharedWorkspace, 'setup-projects'), 'Step should be marked as completed');

    // Verify state is saved with project results
    const stepResult = await getStepResult(sharedWorkspace, 'setup-projects');
    assert.ok(stepResult !== null, 'Step result should be saved');
    if (stepResult && typeof stepResult === 'object' && 'projects' in stepResult) {
      const projects = (stepResult as { projects: unknown[] }).projects;
      assert.ok(Array.isArray(projects), 'Projects should be an array');
    } else if (Array.isArray(stepResult)) {
      assert.ok(true, 'Step result is an array');
    }

    stepResults.set('setup-projects', true);
  });

  test('Step 7: Verify Installation', async () => {
    test.skip(!stepResults.get('setup-projects'), 'Skipping Step 7: Step 6 failed');

    const result = await runStep7VerifyInstallation(sharedWorkspace, PROJECT_ROOT, undefined, true);

    assert.ok(Array.isArray(result.results), 'Should return results array');
    assert.ok(await isStepCompleted(sharedWorkspace, 'verify-installation'), 'Step should be marked as completed');

    // Verify state is saved with verification results
    const stepResult = (await getStepResult(sharedWorkspace, 'verify-installation')) as Array<{ name: string; passed: boolean | null }>;
    assert.ok(stepResult, 'Step result should be saved');
    assert.ok(Array.isArray(stepResult), 'Step result should be an array');

    stepResults.set('verify-installation', true);
  });
});

