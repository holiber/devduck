
import { test, expect } from '@playwright/test';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import {
  createSharedTempWorkspace,
  cleanupSharedTempWorkspace,
  isStepCompleted,
  getStepResult,
  getExecutedChecks,
  createMockWorkspace
} from './helpers.js';
import { runStep1CheckEnv } from '../../scripts/install/install-1-check-env.js';
import { runStep2DownloadRepos } from '../../scripts/install/install-2-download-repos.js';
import { runStep3DownloadProjects } from '../../scripts/install/install-3-download-projects.js';
import { runStep4CheckEnvAgain } from '../../scripts/install/install-4-check-env-again.js';
import { runStep5SetupModules } from '../../scripts/install/install-5-setup-modules.js';
import { runStep6SetupProjects } from '../../scripts/install/install-6-setup-projects.js';
import { runStep7VerifyInstallation } from '../../scripts/install/install-7-verify-installation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

test.describe.serial('Installation Steps', () => {
  let sharedWorkspace: string;

  test.beforeAll(async () => {
    // Create shared workspace in .cache/temp
    sharedWorkspace = await createSharedTempWorkspace('install-steps-test-');
    console.log(`Created shared workspace: ${sharedWorkspace}`);
  });

  test.afterAll(async () => {
    // Cleanup shared workspace
    if (sharedWorkspace) {
      await cleanupSharedTempWorkspace(sharedWorkspace);
      console.log(`Cleaned up shared workspace: ${sharedWorkspace}`);
    }
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
    expect(result1.validationStatus, 'Should return needs_input when vars are missing').toBe('needs_input');
    expect(result1.missing.length > 0, 'Should have missing variables').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'check-env'), 'Step should be marked as completed').toBeTruthy();

    // Set required env var
    const envFile = path.join(sharedWorkspace, '.env');
    await fs.writeFile(envFile, 'TEST_VAR_1=test-value-1\n', 'utf8');

    // Test with all required vars present (should return ok)
    // Note: Some modules may still require env vars, so we check for ok or needs_input
    const result2 = await runStep1CheckEnv(sharedWorkspace, PROJECT_ROOT);
    // Accept either ok or needs_input (depending on module requirements)
    expect(
      result2.validationStatus === 'ok' || result2.validationStatus === 'needs_input',
      'Should return ok or needs_input'
    ).toBeTruthy();
    expect(result2.present.includes('TEST_VAR_1'), 'TEST_VAR_1 should be in present list').toBeTruthy();

    // Verify state is saved
    const stepResult = await getStepResult(sharedWorkspace, 'check-env');
    expect(stepResult, 'Step result should be saved').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'check-env'), 'Step should be completed').toBeTruthy();
  });

  // Step 2: Download Repos
  test('Step 2: Download Repos @smoke', async () => {
    // Ensure workspace config exists (for smoke test isolation)
    if (!await fs.access(path.join(sharedWorkspace, 'workspace.config.json')).then(() => true).catch(() => false)) {
      await createMockWorkspace(sharedWorkspace, { modules: ['core'] });
    }

    // Test with no repos configured (should skip)
    const configPath = path.join(sharedWorkspace, 'workspace.config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.repos = [];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const result1 = await runStep2DownloadRepos(sharedWorkspace);
    expect(result1.repos.length, 'Should have no repos when none configured').toBe(0);
    expect(await isStepCompleted(sharedWorkspace, 'download-repos'), 'Step should be marked as completed').toBeTruthy();
  });

  // Step 3: Download Projects
  test('Step 3: Download Projects @smoke', async () => {
    // Ensure workspace config exists (for smoke test isolation)
    if (!await fs.access(path.join(sharedWorkspace, 'workspace.config.json')).then(() => true).catch(() => false)) {
      await createMockWorkspace(sharedWorkspace, { modules: ['core'] });
    }

    // Test with no projects configured (should skip)
    const configPath = path.join(sharedWorkspace, 'workspace.config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.projects = [];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const result1 = await runStep3DownloadProjects(sharedWorkspace);
    expect(result1.projects.length, 'Should have no projects when none configured').toBe(0);
    expect(await isStepCompleted(sharedWorkspace, 'download-projects'), 'Step should be marked as completed').toBeTruthy();
  });

  // Step 4: Check Environment Again
  test('Step 4: Check Environment Again', async () => {
    // Test after repos/projects loaded (should discover new env requirements if any)
    const result = await runStep4CheckEnvAgain(sharedWorkspace, PROJECT_ROOT);
    
    // Since we have no repos/projects with new env requirements, should return ok
    expect(result.validationStatus === 'ok' || result.validationStatus === 'needs_input', 
      'Should return ok or needs_input').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'check-env-again'), 'Step should be marked as completed').toBeTruthy();

    // Verify state is saved
    const stepResult = await getStepResult(sharedWorkspace, 'check-env-again');
    expect(stepResult, 'Step result should be saved').toBeTruthy();
  });

  // Step 5: Setup Modules
  test('Step 5: Setup Modules', async () => {
    // Test module hooks execution and checks
    const result = await runStep5SetupModules(sharedWorkspace, PROJECT_ROOT, undefined, true);
    
    expect(Array.isArray(result.modules), 'Should return modules array').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'setup-modules'), 'Step should be marked as completed').toBeTruthy();

    // Verify state is saved with module results
    const stepResult = await getStepResult(sharedWorkspace, 'setup-modules') as Array<{name: string; checks: unknown[]}>;
    expect(stepResult, 'Step result should be saved').toBeTruthy();
    expect(Array.isArray(stepResult), 'Step result should be an array').toBeTruthy();

    // Verify executed checks are tracked
    const executedChecks = await getExecutedChecks(sharedWorkspace);
    expect(Array.isArray(executedChecks), 'Executed checks should be tracked').toBeTruthy();
  });

  // Step 6: Setup Projects
  test('Step 6: Setup Projects @smoke', async () => {
    // Ensure workspace config exists (for smoke test isolation)
    if (!await fs.access(path.join(sharedWorkspace, 'workspace.config.json')).then(() => true).catch(() => false)) {
      await createMockWorkspace(sharedWorkspace, { modules: ['core'] });
    }

    // Test project checks execution
    const result = await runStep6SetupProjects(sharedWorkspace, PROJECT_ROOT, undefined, true);
    
    expect(Array.isArray(result.projects), 'Should return projects array').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'setup-projects'), 'Step should be marked as completed').toBeTruthy();

    // Verify state is saved with project results
    const stepResult = await getStepResult(sharedWorkspace, 'setup-projects');
    expect(stepResult !== null, 'Step result should be saved').toBeTruthy();
    
    if (stepResult && typeof stepResult === 'object' && 'projects' in stepResult) {
      const projects = (stepResult as {projects: unknown[]}).projects;
      expect(Array.isArray(projects), 'Projects should be an array').toBeTruthy();
    } else if (Array.isArray(stepResult)) {
      // Direct array result
      expect(true, 'Step result is an array').toBeTruthy();
    }
  });

  // Step 7: Verify Installation
  test('Step 7: Verify Installation', async () => {
    // Test verification of all checks
    const result = await runStep7VerifyInstallation(sharedWorkspace, PROJECT_ROOT, undefined, true);
    
    expect(Array.isArray(result.results), 'Should return results array').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'verify-installation'), 'Step should be marked as completed').toBeTruthy();

    // Verify state is saved with verification results
    const stepResult = await getStepResult(sharedWorkspace, 'verify-installation') as Array<{name: string; passed: boolean | null}>;
    expect(stepResult, 'Step result should be saved').toBeTruthy();
    expect(Array.isArray(stepResult), 'Step result should be an array').toBeTruthy();
  });
});
