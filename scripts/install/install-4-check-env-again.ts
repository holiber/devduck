#!/usr/bin/env node

/**
 * Step 4: Check Environment Again
 * 
 * Re-check env variables after modules/projects are loaded (they may add new requirements)
 */

import path from 'path';
import { readJSON } from '../lib/config.js';
import { print, symbols } from '../utils.js';
import { collectAllEnvRequirements, checkEnvVariables, loadModulesForChecks, loadProjectsForChecks } from './install-common.js';
import { markStepCompleted, type CheckEnvResult, getExecutedChecks } from './install-state.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';

export interface CheckEnvAgainStepResult {
  validationStatus: 'ok' | 'needs_input' | 'failed';
  present: string[];
  missing: string[];
  optional: string[];
}

/**
 * Run Step 4: Check environment variables again (after modules/projects loaded)
 */
export async function runStep4CheckEnvAgain(
  workspaceRoot: string,
  projectRoot: string,
  log?: (message: string) => void
): Promise<CheckEnvAgainStepResult> {
  print(`\n[Step 4] Checking environment variables again...`, 'cyan');
  if (log) {
    log(`[Step 4] Starting environment variable re-check`);
  }
  
  const configFile = path.join(workspaceRoot, 'workspace.config.json');
  const config = readJSON<WorkspaceConfig>(configFile);
  
  if (!config) {
    print(`  ${symbols.error} Cannot read workspace.config.json`, 'red');
    if (log) {
      log(`[Step 4] ERROR: Cannot read workspace.config.json`);
    }
    const result: CheckEnvAgainStepResult = {
      validationStatus: 'failed',
      present: [],
      missing: [],
      optional: []
    };
    markStepCompleted(workspaceRoot, 'check-env-again', result, 'Cannot read workspace.config.json');
    return result;
  }
  
  // Now load all modules including from repos (which were downloaded in step 2)
  let loadedModules: Array<{ name: string; checks?: Array<{ type?: string; var?: string; description?: string; optional?: boolean; install?: string }> }> = [];
  let loadedProjects: Array<{ src?: string; checks?: Array<{ type?: string; var?: string; description?: string; optional?: boolean; install?: string }> }> = [];
  
  try {
    // Load all modules (including from repos)
    loadedModules = await loadModulesForChecks(workspaceRoot, config);
    
    // Load projects (which were downloaded in step 3)
    loadedProjects = loadProjectsForChecks(workspaceRoot, config);
    
    if (log) {
      log(`[Step 4] Loaded ${loadedModules.length} module(s) and ${loadedProjects.length} project(s) for env check`);
    }
  } catch (error) {
    const err = error as Error;
    if (log) {
      log(`[Step 4] Warning: Failed to load some modules/projects: ${err.message}`);
    }
    // Continue with what we have
  }
  
  // Collect all env requirements (including newly discovered ones from repos/projects)
  const allRequirements = collectAllEnvRequirements(workspaceRoot, config, loadedModules, loadedProjects);
  
  // Get checks that were already executed in step 1
  const executedChecks = getExecutedChecks(workspaceRoot);
  const executedCheckIds = new Set(executedChecks.map(c => c.checkId));
  
  // Filter out requirements from checks that have install field OR were already checked in step 1
  const filteredRequirements = new Map<string, { name: string; source: string; sourceName?: string; description?: string; optional?: boolean }>();
  
  for (const [varName, requirement] of allRequirements) {
    // Check if this variable comes from a check with install field
    let hasInstall = false;
    let wasExecuted = false;
    
    // Check in module checks
    for (const module of loadedModules) {
      if (module.checks) {
        for (const check of module.checks) {
          if ((check.type === 'auth' || check.type === 'test') && check.var === varName) {
            // Generate check ID to see if it was executed
            const checkId = `${check.name || 'unknown'}::${check.type || 'unknown'}::${check.var || ''}`;
            if (executedCheckIds.has(checkId)) {
              wasExecuted = true;
            }
            if (check.install && typeof check.install === 'string' && check.install.trim() !== '') {
              hasInstall = true;
              break;
            }
          }
        }
      }
      if (hasInstall || wasExecuted) break;
    }
    
    // Check in project checks
    if (!hasInstall && !wasExecuted) {
      for (const project of loadedProjects) {
        if (project.checks) {
          for (const check of project.checks) {
            if (check.type === 'auth' && check.var === varName) {
              // Generate check ID to see if it was executed
              const checkId = `${check.name || 'unknown'}::${check.type || 'unknown'}::${check.var || ''}`;
              if (executedCheckIds.has(checkId)) {
                wasExecuted = true;
              }
              if (check.install && typeof check.install === 'string' && check.install.trim() !== '') {
                hasInstall = true;
                break;
              }
            }
          }
        }
        if (hasInstall || wasExecuted) break;
      }
    }
    
    // Include if:
    // 1. From config.env (always include)
    // 2. No install field AND not already executed
    if (requirement.source === 'config') {
      filteredRequirements.set(varName, requirement);
    } else if (!hasInstall && !wasExecuted) {
      filteredRequirements.set(varName, requirement);
    }
    // Skip if has install field or was already executed
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
        log(`[Step 4] Found ${envCheck.present.length} environment variable(s)`);
      }
    }
  }
  
  // Show optional variables status (informational)
  if (envCheck.optional.length > 0) {
    if (log) {
      log(`[Step 4] ${envCheck.optional.length} optional variable(s) are missing`);
    }
  }
  
  const result: CheckEnvAgainStepResult = {
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
  markStepCompleted(workspaceRoot, 'check-env-again', stateResult);
  
  if (log) {
    log(`[Step 4] Completed with status: ${validationStatus}`);
  }
  
  if (validationStatus === 'ok') {
    print(`  ${symbols.success} Step 4 completed`, 'green');
  } else {
    print(`  ${symbols.warning} Step 4 requires user input`, 'yellow');
  }
  
  return result;
}

