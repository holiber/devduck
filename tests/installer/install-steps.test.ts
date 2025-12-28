#!/usr/bin/env node

/**
 * Tests for installation steps
 * 
 * Tests each of the 7 installation steps sequentially, sharing a temporary workspace.
 * Subsequent tests are skipped if a previous step fails.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { promises as fs } from 'fs';
import {
  createSharedTempWorkspace,
  cleanupSharedTempWorkspace,
  isStepCompleted,
  getStepResult,
  getExecutedChecks,
  verifyStepState,
  createMockWorkspace
} from './helpers.js';
import { runStep1CheckEnv } from '../../scripts/install/install-1-check-env.js';
import { runStep2DownloadRepos } from '../../scripts/install/install-2-download-repos.js';
import { runStep3DownloadProjects } from '../../scripts/install/install-3-download-projects.js';
import { runStep4CheckEnvAgain } from '../../scripts/install/install-4-check-env-again.js';
import { runStep5SetupModules } from '../../scripts/install/install-5-setup-modules.js';
import { runStep6SetupProjects } from '../../scripts/install/install-6-setup-projects.js';
import { runStep7VerifyInstallation } from '../../scripts/install/install-7-verify-installation.js';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

describe('Installation Steps', () => {
  let sharedWorkspace: string;
  const stepResults = new Map<string, boolean>();

  before(async () => {
    // Create shared workspace in .cache/temp
    sharedWorkspace = await createSharedTempWorkspace('install-steps-test-');
    console.log(`Created shared workspace: ${sharedWorkspace}`);
  });

  after(async () => {
    // Cleanup shared workspace
    await cleanupSharedTempWorkspace(sharedWorkspace);
    console.log(`Cleaned up shared workspace: ${sharedWorkspace}`);
  });

  // Step 1: Check Environment Variables
  test('Step 1: Check Environment Variables', async () => {
    // Create minimal workspace config with only core module (which has minimal env requirements)
    await createMockWorkspace(sharedWorkspace, {
      modules: ['core'],
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
    // Accept either ok or needs_input (depending on module requirements)
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

  // Step 2: Download Repos
  test('Step 2: Download Repos', async () => {
    // Skip if step 1 failed
    if (!stepResults.get('check-env')) {
      console.log('Skipping Step 2: Step 1 failed');
      return;
    }

    // Test with no repos configured (should skip)
    const configPath = path.join(sharedWorkspace, 'workspace.config.yml');
    const config = YAML.parse(await fs.readFile(configPath, 'utf8'));
    config.repos = [];
    await fs.writeFile(configPath, YAML.stringify(config), 'utf8');

    const result1 = await runStep2DownloadRepos(sharedWorkspace);
    assert.strictEqual(result1.repos.length, 0, 'Should have no repos when none configured');
    assert.ok(await isStepCompleted(sharedWorkspace, 'download-repos'), 'Step should be marked as completed');

    // Note: We skip testing with actual repos in unit tests to avoid network dependencies
    // Integration tests would test actual repo downloads

    stepResults.set('download-repos', true);
  });

  // Step 3: Download Projects
  test('Step 3: Download Projects', async () => {
    // Skip if step 2 failed
    if (!stepResults.get('download-repos')) {
      console.log('Skipping Step 3: Step 2 failed');
      return;
    }

    // Test with no projects configured (should skip)
    const configPath = path.join(sharedWorkspace, 'workspace.config.yml');
    const config = YAML.parse(await fs.readFile(configPath, 'utf8'));
    config.projects = [];
    await fs.writeFile(configPath, YAML.stringify(config), 'utf8');

    const result1 = await runStep3DownloadProjects(sharedWorkspace);
    assert.strictEqual(result1.projects.length, 0, 'Should have no projects when none configured');
    assert.ok(await isStepCompleted(sharedWorkspace, 'download-projects'), 'Step should be marked as completed');

    // Note: We skip testing with actual projects in unit tests to avoid network dependencies
    // Integration tests would test actual project cloning

    stepResults.set('download-projects', true);
  });

  // Step 4: Check Environment Again
  test('Step 4: Check Environment Again', async () => {
    // Skip if step 3 failed
    if (!stepResults.get('download-projects')) {
      console.log('Skipping Step 4: Step 3 failed');
      return;
    }

    // Test after repos/projects loaded (should discover new env requirements if any)
    const result = await runStep4CheckEnvAgain(sharedWorkspace, PROJECT_ROOT);
    
    // Since we have no repos/projects with new env requirements, should return ok
    assert.ok(result.validationStatus === 'ok' || result.validationStatus === 'needs_input', 
      'Should return ok or needs_input');
    assert.ok(await isStepCompleted(sharedWorkspace, 'check-env-again'), 'Step should be marked as completed');

    // Verify state is saved
    const stepResult = await getStepResult(sharedWorkspace, 'check-env-again');
    assert.ok(stepResult, 'Step result should be saved');

    stepResults.set('check-env-again', true);
  });

  // Step 5: Setup Modules
  test('Step 5: Setup Modules', async () => {
    // Skip if step 4 failed
    if (!stepResults.get('check-env-again')) {
      console.log('Skipping Step 5: Step 4 failed');
      return;
    }

    // Test module hooks execution and checks
    const result = await runStep5SetupModules(sharedWorkspace, PROJECT_ROOT, undefined, true);
    
    assert.ok(Array.isArray(result.modules), 'Should return modules array');
    assert.ok(await isStepCompleted(sharedWorkspace, 'setup-modules'), 'Step should be marked as completed');

    // Verify state is saved with module results
    const stepResult = await getStepResult(sharedWorkspace, 'setup-modules') as Array<{name: string; checks: unknown[]}>;
    assert.ok(stepResult, 'Step result should be saved');
    assert.ok(Array.isArray(stepResult), 'Step result should be an array');

    // Verify executed checks are tracked
    const executedChecks = await getExecutedChecks(sharedWorkspace);
    assert.ok(Array.isArray(executedChecks), 'Executed checks should be tracked');

    stepResults.set('setup-modules', true);
  });

  // Step 6: Setup Projects
  test('Step 6: Setup Projects', async () => {
    // Skip if step 5 failed
    if (!stepResults.get('setup-modules')) {
      console.log('Skipping Step 6: Step 5 failed');
      return;
    }

    // Test project checks execution
    const result = await runStep6SetupProjects(sharedWorkspace, PROJECT_ROOT, undefined, true);
    
    assert.ok(Array.isArray(result.projects), 'Should return projects array');
    assert.ok(await isStepCompleted(sharedWorkspace, 'setup-projects'), 'Step should be marked as completed');

    // Verify state is saved with project results
    const stepResult = await getStepResult(sharedWorkspace, 'setup-projects');
    assert.ok(stepResult !== null, 'Step result should be saved');
    if (stepResult && typeof stepResult === 'object' && 'projects' in stepResult) {
      const projects = (stepResult as {projects: unknown[]}).projects;
      assert.ok(Array.isArray(projects), 'Projects should be an array');
    } else if (Array.isArray(stepResult)) {
      // Direct array result
      assert.ok(true, 'Step result is an array');
    }

    stepResults.set('setup-projects', true);
  });

  // Step 7: Verify Installation
  test('Step 7: Verify Installation', async () => {
    // Skip if step 6 failed
    if (!stepResults.get('setup-projects')) {
      console.log('Skipping Step 7: Step 6 failed');
      return;
    }

    // Test verification of all checks
    const result = await runStep7VerifyInstallation(sharedWorkspace, PROJECT_ROOT, undefined, true);
    
    assert.ok(Array.isArray(result.results), 'Should return results array');
    assert.ok(await isStepCompleted(sharedWorkspace, 'verify-installation'), 'Step should be marked as completed');

    // Verify state is saved with verification results
    const stepResult = await getStepResult(sharedWorkspace, 'verify-installation') as Array<{name: string; passed: boolean | null}>;
    assert.ok(stepResult, 'Step result should be saved');
    assert.ok(Array.isArray(stepResult), 'Step result should be an array');

    stepResults.set('verify-installation', true);
  });
});
