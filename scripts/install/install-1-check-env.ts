#!/usr/bin/env node

/**
 * Step 1: Check Environment Variables
 * 
 * Verify required env variables exist (from workspace config, modules, projects)
 * Skip checks that have non-empty `install` field (those will run in later steps)
 * Stop installation with warning if variables are missing
 */

import path from 'path';
import { readWorkspaceConfigFromRoot } from '../lib/workspace-config.js';
import { print, symbols } from '../utils.js';
import { collectAllEnvRequirements, checkEnvVariables, loadModulesForChecks, loadProjectsForChecks } from './install-common.js';
import { markStepCompleted, type CheckEnvResult } from './install-state.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { InstallContext, StepOutcome } from './runner.js';

export interface CheckEnvStepResult {
  validationStatus: 'ok' | 'needs_input' | 'failed';
  present: string[];
  missing: string[];
  optional: string[];
}

/**
 * Run Step 1: Check environment variables
 */
export async function runStep1CheckEnv(
  workspaceRoot: string,
  projectRoot: string,
  log?: (message: string) => void
): Promise<CheckEnvStepResult> {
  print(`\n[Step 1] Checking environment variables...`, 'cyan');
  if (log) {
    log(`[Step 1] Starting environment variable check`);
  }
  
  const { config, configFile } = readWorkspaceConfigFromRoot<WorkspaceConfig>(workspaceRoot);
  
  if (!config) {
    print(`  ${symbols.error} Cannot read workspace config (${path.basename(configFile)})`, 'red');
    if (log) {
      log(`[Step 1] ERROR: Cannot read workspace config (${configFile})`);
    }
    const result: CheckEnvStepResult = {
      validationStatus: 'failed',
      present: [],
      missing: [],
      optional: []
    };
    markStepCompleted(workspaceRoot, 'check-env', result, `Cannot read ${path.basename(configFile)}`);
    return result;
  }
  
  // Load modules and projects to collect env requirements
  // Note: At this step, we only load from config and basic module/project definitions
  // We don't load from repos yet (that's step 2)
  let loadedModules: Array<{ name: string; checks?: Array<{ type?: string; var?: string; description?: string; optional?: boolean; install?: string }> }> = [];
  let loadedProjects: Array<{ src?: string; checks?: Array<{ type?: string; var?: string; description?: string; optional?: boolean; install?: string }> }> = [];
  
  try {
    // Load available modules (without external repos at this step), then resolve
    // the *selected* modules from workspace config (including dependencies).
    //
    // IMPORTANT: Do NOT collect env requirements from all available modules,
    // otherwise we will incorrectly require tokens for modules that are not installed.
    const { getAllModules, getAllModulesFromDirectory, expandModuleNames, resolveDependencies } =
      await import('./module-resolver.js');

    const localModules = getAllModules();
    const workspaceModulesDir = path.join(workspaceRoot, 'modules');
    const workspaceModules = getAllModulesFromDirectory(workspaceModulesDir);

    // Priority: workspace modules override built-in modules with the same name.
    const allModules = [...workspaceModules, ...localModules];

    const moduleNames = expandModuleNames(Array.isArray(config.modules) ? config.modules : ['*'], allModules);
    const resolvedModules = resolveDependencies(moduleNames, allModules);

    loadedModules = resolvedModules;
    
    // Load projects from config
    loadedProjects = loadProjectsForChecks(workspaceRoot, config);
    
    if (log) {
      log(`[Step 1] Loaded ${loadedModules.length} module(s) and ${loadedProjects.length} project(s) for env check`);
    }
  } catch (error) {
    const err = error as Error;
    if (log) {
      log(`[Step 1] Warning: Failed to load some modules/projects: ${err.message}`);
    }
    // Continue with what we have
  }
  
  // Collect env requirements, but skip checks that have install field
  // (those will be handled in later steps)
  const allRequirements = collectAllEnvRequirements(workspaceRoot, config, loadedModules, loadedProjects);
  
  // Filter out requirements from checks that have install field
  // We need to check the original checks to see if they have install
  const filteredRequirements = new Map<string, { name: string; source: string; sourceName?: string; description?: string; optional?: boolean }>();
  
  for (const [varName, requirement] of allRequirements) {
    // Check if this variable comes from a check with install field
    let hasInstall = false;
    
    // Check in module checks
    for (const module of loadedModules) {
      if (module.checks) {
        for (const check of module.checks) {
          if ((check.type === 'auth' || check.type === 'test') && check.var === varName) {
            if (check.install && typeof check.install === 'string' && check.install.trim() !== '') {
              hasInstall = true;
              break;
            }
          }
        }
      }
      if (hasInstall) break;
    }
    
    // Check in project checks
    if (!hasInstall) {
      for (const project of loadedProjects) {
        if (project.checks) {
          for (const check of project.checks) {
            if (check.type === 'auth' && check.var === varName) {
              if (check.install && typeof check.install === 'string' && check.install.trim() !== '') {
                hasInstall = true;
                break;
              }
            }
          }
        }
        if (hasInstall) break;
      }
    }
    
    // Check in config.env
    if (!hasInstall && requirement.source === 'config') {
      // Config env vars don't have install field, so include them
      filteredRequirements.set(varName, requirement);
    } else if (!hasInstall) {
      // Include if no install field
      filteredRequirements.set(varName, requirement);
    }
    // If hasInstall is true, skip this requirement (will be checked in later steps)
  }
  
  // Check which variables are present/missing
  const envCheck = checkEnvVariables(workspaceRoot, filteredRequirements, log);
  
  // Determine validation status
  let validationStatus: 'ok' | 'needs_input' | 'failed' = 'ok';
  
  if (envCheck.missing.length > 0) {
    // Show missing variables
    print(`\n  ${symbols.warning} Missing required environment variables:`, 'yellow');
    for (const varName of envCheck.missing) {
      const req = filteredRequirements.get(varName);
      const sourceInfo = req?.sourceName ? ` (${req.source}: ${req.sourceName})` : ` (${req?.source || 'unknown'})`;
      const desc = req?.description ? ` - ${req.description}` : '';
      print(`    - ${varName}${sourceInfo}${desc}`, 'yellow');
    }
    
    print(`\n  ${symbols.info} Please:`, 'cyan');
    print(`    1. Switch to workspace folder: cd ${workspaceRoot}`, 'cyan');
    print(`    2. Set missing variables in .env file or environment variables`, 'cyan');
    print(`    3. Re-run installation`, 'cyan');
    
    validationStatus = 'needs_input';
  } else {
    print(`  ${symbols.success} All required environment variables are present`, 'green');
    if (envCheck.present.length > 0) {
      if (log) {
        log(`[Step 1] Found ${envCheck.present.length} environment variable(s)`);
      }
    }
  }
  
  // Show optional variables status (informational)
  if (envCheck.optional.length > 0) {
    if (log) {
      log(`[Step 1] ${envCheck.optional.length} optional variable(s) are missing`);
    }
  }
  
  const result: CheckEnvStepResult = {
    validationStatus,
    present: envCheck.present,
    missing: envCheck.missing,
    optional: envCheck.optional
  };
  
  // Save step result
  const stateResult: CheckEnvResult = {
    present: envCheck.present,
    missing: envCheck.missing,
    optional: envCheck.optional,
    validationStatus
  };
  markStepCompleted(workspaceRoot, 'check-env', stateResult);
  
  if (log) {
    log(`[Step 1] Completed with status: ${validationStatus}`);
  }
  
  if (validationStatus === 'ok') {
    print(`  ${symbols.success} Step 1 completed`, 'green');
  } else {
    print(`  ${symbols.warning} Step 1 requires user input`, 'yellow');
  }
  
  return result;
}

export async function installStep1CheckEnv(ctx: InstallContext): Promise<StepOutcome> {
  const res = await runStep1CheckEnv(ctx.workspaceRoot, ctx.projectRoot, (m) => ctx.logger.info(m));
  if (res.validationStatus === 'needs_input') {
    return { status: 'needs_input', message: 'Missing required environment variables' };
  }
  if (res.validationStatus === 'failed') {
    return { status: 'failed', error: 'Environment check failed' };
  }
  return { status: 'ok' };
}

