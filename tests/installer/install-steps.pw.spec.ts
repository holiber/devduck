/**
 * Playwright Test port of `install-steps.test.ts`
 *
 * Tests each of the 7 installation steps sequentially, sharing a temporary workspace.
 * Subsequent tests are skipped if a previous step fails.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createSharedTempWorkspace,
  cleanupSharedTempWorkspace,
  isStepCompleted,
  getStepResult,
  getExecutedChecks,
  createMockWorkspace
} from './helpers.ts';

import { runStep1CheckEnv } from '../../scripts/install/install-1-check-env.ts';
import { runStep2DownloadRepos } from '../../scripts/install/install-2-download-repos.ts';
import { runStep3DownloadProjects } from '../../scripts/install/install-3-download-projects.ts';
import { runStep4CheckEnvAgain } from '../../scripts/install/install-4-check-env-again.ts';
import { runStep5SetupModules } from '../../scripts/install/install-5-setup-modules.ts';
import { runStep6SetupProjects } from '../../scripts/install/install-6-setup-projects.ts';
import { runStep7VerifyInstallation } from '../../scripts/install/install-7-verify-installation.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

test.describe.serial('Installation Steps', () => {
  let sharedWorkspace: string;
  const stepResults = new Map<string, boolean>();

  test.beforeAll(async () => {
    sharedWorkspace = await createSharedTempWorkspace('install-steps-test-');
  });

  test.afterAll(async () => {
    await cleanupSharedTempWorkspace(sharedWorkspace);
  });

  async function ensureStep(id: string, run: () => Promise<void>): Promise<void> {
    if (stepResults.get(id)) return;
    await run();
    stepResults.set(id, true);
  }

  async function step1(): Promise<void> {
    await createMockWorkspace(sharedWorkspace, {
      modules: ['core'],
      env: [
        { name: 'TEST_VAR_1', description: 'Test variable 1' },
        { name: 'TEST_VAR_2', description: 'Test variable 2', optional: true }
      ]
    });

    process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-github-token';
    process.env.CURSOR_API_KEY = process.env.CURSOR_API_KEY || 'test-cursor-api-key';

    const result1 = await runStep1CheckEnv(sharedWorkspace, PROJECT_ROOT);
    expect(result1.validationStatus, 'Should return needs_input when vars are missing').toBe('needs_input');
    expect(result1.missing.length > 0, 'Should have missing variables').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'check-env'), 'Step should be marked as completed').toBeTruthy();

    const envFile = path.join(sharedWorkspace, '.env');
    await fs.writeFile(envFile, 'TEST_VAR_1=test-value-1\n', 'utf8');

    const result2 = await runStep1CheckEnv(sharedWorkspace, PROJECT_ROOT);
    expect(
      result2.validationStatus === 'ok' || result2.validationStatus === 'needs_input',
      'Should return ok or needs_input'
    ).toBeTruthy();
    expect(result2.present.includes('TEST_VAR_1'), 'TEST_VAR_1 should be in present list').toBeTruthy();

    const stepResult = await getStepResult(sharedWorkspace, 'check-env');
    expect(stepResult, 'Step result should be saved').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'check-env'), 'Step should be completed').toBeTruthy();
  }

  async function step2(): Promise<void> {
    const configPath = path.join(sharedWorkspace, 'workspace.config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as any;
    config.repos = [];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const result1 = await runStep2DownloadRepos(sharedWorkspace);
    expect(result1.repos.length, 'Should have no repos when none configured').toBe(0);
    expect(await isStepCompleted(sharedWorkspace, 'download-repos'), 'Step should be marked as completed').toBeTruthy();
  }

  async function step3(): Promise<void> {
    const configPath = path.join(sharedWorkspace, 'workspace.config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as any;
    config.projects = [];
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    const result1 = await runStep3DownloadProjects(sharedWorkspace);
    expect(result1.projects.length, 'Should have no projects when none configured').toBe(0);
    expect(await isStepCompleted(sharedWorkspace, 'download-projects'), 'Step should be marked as completed').toBeTruthy();
  }

  async function step4(): Promise<void> {
    const result = await runStep4CheckEnvAgain(sharedWorkspace, PROJECT_ROOT);
    expect(
      result.validationStatus === 'ok' || result.validationStatus === 'needs_input',
      'Should return ok or needs_input'
    ).toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'check-env-again'), 'Step should be marked as completed').toBeTruthy();

    const stepResult = await getStepResult(sharedWorkspace, 'check-env-again');
    expect(stepResult, 'Step result should be saved').toBeTruthy();
  }

  async function step5(): Promise<void> {
    const result = await runStep5SetupModules(sharedWorkspace, PROJECT_ROOT, undefined, true);
    expect(Array.isArray(result.modules), 'Should return modules array').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'setup-modules'), 'Step should be marked as completed').toBeTruthy();

    const stepResult = (await getStepResult(sharedWorkspace, 'setup-modules')) as Array<{
      name: string;
      checks: unknown[];
    }> | null;
    expect(stepResult, 'Step result should be saved').toBeTruthy();
    expect(Array.isArray(stepResult), 'Step result should be an array').toBeTruthy();

    const executedChecks = await getExecutedChecks(sharedWorkspace);
    expect(Array.isArray(executedChecks), 'Executed checks should be tracked').toBeTruthy();
  }

  async function step6(): Promise<void> {
    const result = await runStep6SetupProjects(sharedWorkspace, PROJECT_ROOT, undefined, true);
    expect(Array.isArray(result.projects), 'Should return projects array').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'setup-projects'), 'Step should be marked as completed').toBeTruthy();

    const stepResult = await getStepResult(sharedWorkspace, 'setup-projects');
    expect(stepResult !== null, 'Step result should be saved').toBeTruthy();

    if (stepResult && typeof stepResult === 'object' && 'projects' in stepResult) {
      expect(Array.isArray((stepResult as { projects: unknown[] }).projects), 'Projects should be an array').toBeTruthy();
    } else if (Array.isArray(stepResult)) {
      expect(true, 'Step result is an array').toBeTruthy();
    }
  }

  async function step7(): Promise<void> {
    const result = await runStep7VerifyInstallation(sharedWorkspace, PROJECT_ROOT, undefined, true);
    expect(Array.isArray(result.results), 'Should return results array').toBeTruthy();
    expect(await isStepCompleted(sharedWorkspace, 'verify-installation'), 'Step should be marked as completed').toBeTruthy();

    const stepResult = (await getStepResult(sharedWorkspace, 'verify-installation')) as Array<{
      name: string;
      passed: boolean | null;
    }> | null;
    expect(stepResult, 'Step result should be saved').toBeTruthy();
    expect(Array.isArray(stepResult), 'Step result should be an array').toBeTruthy();
  }

  test('Step 1: Check Environment Variables', async () => {
    await ensureStep('check-env', step1);
  });

  test('@smoke Step 2: Download Repos', async () => {
    await ensureStep('check-env', step1);
    await ensureStep('download-repos', step2);
  });

  test('@smoke Step 3: Download Projects', async () => {
    await ensureStep('check-env', step1);
    await ensureStep('download-repos', step2);
    await ensureStep('download-projects', step3);
  });

  test('Step 4: Check Environment Again', async () => {
    await ensureStep('check-env', step1);
    await ensureStep('download-repos', step2);
    await ensureStep('download-projects', step3);
    await ensureStep('check-env-again', step4);
  });

  test('Step 5: Setup Modules', async () => {
    await ensureStep('check-env', step1);
    await ensureStep('download-repos', step2);
    await ensureStep('download-projects', step3);
    await ensureStep('check-env-again', step4);
    await ensureStep('setup-modules', step5);
  });

  test('@smoke Step 6: Setup Projects', async () => {
    await ensureStep('check-env', step1);
    await ensureStep('download-repos', step2);
    await ensureStep('download-projects', step3);
    await ensureStep('check-env-again', step4);
    await ensureStep('setup-modules', step5);
    await ensureStep('setup-projects', step6);
  });

  test('Step 7: Verify Installation', async () => {
    await ensureStep('check-env', step1);
    await ensureStep('download-repos', step2);
    await ensureStep('download-projects', step3);
    await ensureStep('check-env-again', step4);
    await ensureStep('setup-modules', step5);
    await ensureStep('setup-projects', step6);
    await ensureStep('verify-installation', step7);
  });
});

