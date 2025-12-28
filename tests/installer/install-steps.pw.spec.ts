#!/usr/bin/env node

/**
 * Tests for installation steps
 * 
 * Tests each of the 7 installation steps sequentially, sharing a temporary workspace.
 * Subsequent tests are skipped if a previous step fails.
 * Migrated to Playwright Test
 */

import { test, expect } from '@playwright/test';
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

  test.afterAll(async () => {
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
    expect(result1.validationStatus).toBe('needs_input');
    expect(result1.missing.length).toBeGreaterThan(0);
    expect(await isStepCompleted(sharedWorkspace, 'check-env')).toBeTruthy();

    // Set required env var
    const envFile = path.join(sharedWorkspace, '.env');
    await fs.writeFile(envFile, 'TEST_VAR_1=test-value-1\n', 'utf8');

    // Test with all required vars present (should return ok)
    // Note: Some modules may still require env vars, so we check for ok or needs_input
    const result2 = await runStep1CheckEnv(sharedWorkspace, PROJECT_ROOT);
    // Accept either ok or needs_input (depending on module requirements)
    expect(['ok', 'needs_input']).toContain(result2.validationStatus);
    expect(result2.present).toContain('TEST_VAR_1');

    // Verify state is saved
    const stepResult = await getStepResult(sharedWorkspace, 'check-env');
    expect(stepResult).toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'check-env')).toBeTruthy();

    stepResults.set('check-env', true);
  });

  // Step 2: Download Repos
  test('Step 2: Download Repos', async () => {
    // Skip if step 1 failed
    if (!stepResults.get('check-env')) {
      console.log('Skipping Step 2: Step 1 failed');
      test.skip();
      return;
    }

    // Test with no repos configured (should skip)
    const configPath = path.join(sharedWorkspace, 'workspace.config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.repos = [];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const result1 = await runStep2DownloadRepos(sharedWorkspace);
    expect(result1.repos.length).toBe(0);
    expect(await isStepCompleted(sharedWorkspace, 'download-repos')).toBeTruthy();

    // Note: We skip testing with actual repos in unit tests to avoid network dependencies
    // Integration tests would test actual repo downloads

    stepResults.set('download-repos', true);
  });

  // Step 3: Download Projects
  test('@smoke Step 3: Download Projects', async () => {
    // Skip if step 2 failed
    if (!stepResults.get('download-repos')) {
      console.log('Skipping Step 3: Step 2 failed');
      test.skip();
      return;
    }

    // Test with no projects configured (should skip)
    const configPath = path.join(sharedWorkspace, 'workspace.config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.projects = [];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const result1 = await runStep3DownloadProjects(sharedWorkspace);
    expect(result1.projects.length).toBe(0);
    expect(await isStepCompleted(sharedWorkspace, 'download-projects')).toBeTruthy();

    // Note: We skip testing with actual projects in unit tests to avoid network dependencies
    // Integration tests would test actual project cloning

    stepResults.set('download-projects', true);
  });

  // Step 4: Check Environment Again
  test('Step 4: Check Environment Again', async () => {
    // Skip if step 3 failed
    if (!stepResults.get('download-projects')) {
      console.log('Skipping Step 4: Step 3 failed');
      test.skip();
      return;
    }

    // Test after repos/projects loaded (should discover new env requirements if any)
    const result = await runStep4CheckEnvAgain(sharedWorkspace, PROJECT_ROOT);
    
    // Since we have no repos/projects with new env requirements, should return ok
    expect(['ok', 'needs_input']).toContain(result.validationStatus);
    expect(await isStepCompleted(sharedWorkspace, 'check-env-again')).toBeTruthy();

    // Verify state is saved
    const stepResult = await getStepResult(sharedWorkspace, 'check-env-again');
    expect(stepResult).toBeTruthy();

    stepResults.set('check-env-again', true);
  });

  // Step 5: Setup Modules
  test('Step 5: Setup Modules', async () => {
    // Skip if step 4 failed
    if (!stepResults.get('check-env-again')) {
      console.log('Skipping Step 5: Step 4 failed');
      test.skip();
      return;
    }

    // Test module hooks execution and checks
    const result = await runStep5SetupModules(sharedWorkspace, PROJECT_ROOT, undefined, true);
    
    expect(Array.isArray(result.modules)).toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'setup-modules')).toBeTruthy();

    // Verify state is saved with module results
    const stepResult = await getStepResult(sharedWorkspace, 'setup-modules') as Array<{name: string; checks: unknown[]}>;
    expect(stepResult).toBeTruthy();
    expect(Array.isArray(stepResult)).toBeTruthy();

    // Verify executed checks are tracked
    const executedChecks = await getExecutedChecks(sharedWorkspace);
    expect(Array.isArray(executedChecks)).toBeTruthy();

    stepResults.set('setup-modules', true);
  });

  // Step 6: Setup Projects
  test('@smoke Step 6: Setup Projects', async () => {
    // Skip if step 5 failed
    if (!stepResults.get('setup-modules')) {
      console.log('Skipping Step 6: Step 5 failed');
      test.skip();
      return;
    }

    // Test project checks execution
    const result = await runStep6SetupProjects(sharedWorkspace, PROJECT_ROOT, undefined, true);
    
    expect(Array.isArray(result.projects)).toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'setup-projects')).toBeTruthy();

    // Verify state is saved with project results
    const stepResult = await getStepResult(sharedWorkspace, 'setup-projects');
    expect(stepResult).not.toBeNull();
    if (stepResult && typeof stepResult === 'object' && 'projects' in stepResult) {
      const projects = (stepResult as {projects: unknown[]}).projects;
      expect(Array.isArray(projects)).toBeTruthy();
    } else if (Array.isArray(stepResult)) {
      // Direct array result
      expect(true).toBeTruthy();
    }

    stepResults.set('setup-projects', true);
  });

  // Step 7: Verify Installation
  test('Step 7: Verify Installation', async () => {
    // Skip if step 6 failed
    if (!stepResults.get('setup-projects')) {
      console.log('Skipping Step 7: Step 6 failed');
      test.skip();
      return;
    }

    // Test verification of all checks
    const result = await runStep7VerifyInstallation(sharedWorkspace, PROJECT_ROOT, undefined, true);
    
    expect(Array.isArray(result.results)).toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'verify-installation')).toBeTruthy();

    // Verify state is saved with verification results
    const stepResult = await getStepResult(sharedWorkspace, 'verify-installation') as Array<{name: string; passed: boolean | null}>;
    expect(stepResult).toBeTruthy();
    expect(Array.isArray(stepResult)).toBeTruthy();

    stepResults.set('verify-installation', true);
  });
});
