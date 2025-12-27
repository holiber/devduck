#!/usr/bin/env node

import path from 'path';
import { print, symbols } from '../utils.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import { collectAllEnvRequirements, checkEnvVariables, loadModulesForChecks, loadProjectsForChecks } from './install-common.js';
import type { CheckEnvResult } from './install-state.js';

export async function installStep4CheckEnvAgain(params: {
  workspaceRoot: string;
  config: WorkspaceConfig;
  log: (msg: string) => void;
}): Promise<{ ok: boolean; result: CheckEnvResult }> {
  const { workspaceRoot, config, log } = params;

  print(`\n[Step 4] Check environment variables again...`, 'cyan');
  log(`[step-4] Checking environment variables again`);

  const envFile = path.join(workspaceRoot, '.env');

  const loadedModules = await loadModulesForChecks(workspaceRoot, config, {
    includeRepos: true,
    includeProjectsModules: true
  });
  const loadedProjects = loadProjectsForChecks(workspaceRoot, config);

  const envRequirements = collectAllEnvRequirements(workspaceRoot, config, loadedModules, loadedProjects, {
    includeChecksWithInstall: false
  });

  const summary = checkEnvVariables(envRequirements, envFile);
  const result: CheckEnvResult = {
    present: summary.present,
    missing: summary.missing,
    optionalMissing: summary.optionalMissing,
    requirements: summary.requirements
  };

  if (result.missing.length > 0) {
    print(`\n${symbols.warning} Step 4 warning: missing required environment variables`, 'yellow');
    print(`  Missing: ${result.missing.join(', ')}`, 'yellow');
    print(`  Fix: open "${workspaceRoot}", update ".env", then re-run the installer`, 'cyan');
    return { ok: false, result };
  }

  print(`\n${symbols.success} Step 4 completed`, 'green');
  return { ok: true, result };
}

