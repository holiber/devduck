#!/usr/bin/env node

import { print, symbols } from '../utils.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';

import { readInstallState, updateInstallStep, writeInstallState } from './install-state.js';

import { installStep1CheckEnv } from './install-1-check-env.js';
import { installStep2DownloadRepos } from './install-2-download-repos.js';
import { installStep3DownloadProjects } from './install-3-download-projects.js';
import { installStep4CheckEnvAgain } from './install-4-check-env-again.js';
import { installStep5SetupModules } from './install-5-setup-modules.js';
import { installStep6SetupProjects } from './install-6-setup-projects.js';
import { installStep7VerifyInstallation } from './install-7-verify-installation.js';

export async function runInstallSteps(params: {
  workspaceRoot: string;
  config: WorkspaceConfig;
  autoYes: boolean;
  log: (msg: string) => void;
}): Promise<{ ok: boolean }> {
  const { workspaceRoot, config, autoYes, log } = params;

  // Ensure state file exists (do not wipe previous state).
  writeInstallState(workspaceRoot, readInstallState(workspaceRoot));

  // Step 1 (critical)
  const step1 = await installStep1CheckEnv({ workspaceRoot, config, log });
  updateInstallStep(workspaceRoot, 'check-env', { completed: step1.ok, result: step1.result });
  if (!step1.ok) return { ok: false };

  // Step 2 (warning on failure)
  const step2 = await installStep2DownloadRepos({ workspaceRoot, config, log });
  updateInstallStep(workspaceRoot, 'download-repos', { completed: step2.ok, result: { repos: step2.repos } });

  // Step 3 (warning on failure)
  const step3 = await installStep3DownloadProjects({ workspaceRoot, config, log });
  updateInstallStep(workspaceRoot, 'download-projects', { completed: step3.ok, result: { projects: step3.projects } });

  // Step 4 (critical)
  const step4 = await installStep4CheckEnvAgain({ workspaceRoot, config, log });
  updateInstallStep(workspaceRoot, 'check-env-again', { completed: step4.ok, result: step4.result });
  if (!step4.ok) return { ok: false };

  // Step 5 (critical on hook failures; check failures are warnings and we proceed)
  const step5 = await installStep5SetupModules({ workspaceRoot, config, autoYes, log });
  updateInstallStep(workspaceRoot, 'setup-modules', { completed: step5.ok, result: step5.result });
  // Persist installed module paths at top-level for downstream tooling (also used by --status).
  const stateAfter5 = readInstallState(workspaceRoot);
  stateAfter5.installedModules = step5.result.installedModules;
  writeInstallState(workspaceRoot, stateAfter5);

  // Step 6 (warning on failures; proceed to verification)
  const step6 = await installStep6SetupProjects({ workspaceRoot, config, autoYes, log });
  updateInstallStep(workspaceRoot, 'setup-projects', { completed: step6.ok, result: step6.result });

  // Step 7 (final)
  const step7 = await installStep7VerifyInstallation({ workspaceRoot, config, log });
  updateInstallStep(workspaceRoot, 'verify-installation', { completed: step7.ok, result: step7.result });
  const stateAfter7 = readInstallState(workspaceRoot);
  stateAfter7.installedAt = new Date().toISOString();
  stateAfter7.mcpServers = step7.result.mcpServers;
  stateAfter7.checks = step7.result.checks;
  writeInstallState(workspaceRoot, stateAfter7);

  if (!step2.ok) {
    print(`\n${symbols.warning} Step 2 warning: some repos failed to download`, 'yellow');
  }
  if (!step3.ok) {
    print(`\n${symbols.warning} Step 3 warning: some projects failed to download/link`, 'yellow');
  }
  if (!step5.ok) {
    print(`\n${symbols.warning} Step 5 warning: module setup reported failures`, 'yellow');
  }
  if (!step6.ok) {
    print(`\n${symbols.warning} Step 6 warning: project setup reported failures`, 'yellow');
  }

  return { ok: step7.ok };
}

