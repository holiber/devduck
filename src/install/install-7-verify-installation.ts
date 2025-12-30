#!/usr/bin/env node

/**
 * Step 7: Verify Installation
 * 
 * Execute `test` field for all checks to verify tokens/connections
 */

import path from 'path';
import { readWorkspaceConfigFromRoot } from '../lib/workspace-config.js';
import { print, symbols } from '../utils.js';
import { loadModulesForChecks, loadProjectsForChecks, createCheckFunctions } from './install-common.js';
import {
  markStepCompleted,
  type VerificationResult,
  trackCheckExecution,
  generateCheckId
} from './install-state.js';
import { processCheck } from './process-check.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { CheckItem, CheckResult } from './types.js';
import { getCheckRequirement } from './types.js';
import type { InstallContext, StepOutcome } from './runner.js';

export interface VerifyInstallationStepResult {
  results: VerificationResult[];
}

/**
 * Run Step 7: Verify installation
 */
export async function runStep7VerifyInstallation(
  workspaceRoot: string,
  projectRoot: string,
  log?: (message: string) => void,
  autoYes = false
): Promise<VerifyInstallationStepResult> {
  if (process.env.DEVDUCK_SUPPRESS_STEP_HEADER !== '1') {
    print(`\n[Step 7] Verifying installation...`, 'cyan');
  }
  if (log) {
    log(`[Step 7] Starting installation verification`);
  }
  
  const { config, configFile } = readWorkspaceConfigFromRoot<WorkspaceConfig>(workspaceRoot);
  
  if (!config) {
    print(`  ${symbols.error} Cannot read workspace config (${path.basename(configFile)})`, 'red');
    if (log) {
      log(`[Step 7] ERROR: Cannot read workspace config (${configFile})`);
    }
    const result: VerifyInstallationStepResult = { results: [] };
    markStepCompleted(workspaceRoot, 'verify-installation', result, `Cannot read ${path.basename(configFile)}`);
    return result;
  }
  
  // Load all modules and projects to get all checks
  let allChecks: Array<{ check: CheckItem; source: 'config' | 'module' | 'project'; sourceName?: string }> = [];
  
  try {
    // Add checks from config.checks
    if (config.checks && Array.isArray(config.checks)) {
      for (const check of config.checks) {
        allChecks.push({
          check: check as CheckItem,
          source: 'config'
        });
      }
    }
    
    // Load modules and add their checks
    const loadedModules = await loadModulesForChecks(workspaceRoot, config);
    for (const module of loadedModules) {
      if (module.checks) {
        for (const check of module.checks) {
          allChecks.push({
            check: check as CheckItem,
            source: 'module',
            sourceName: module.name
          });
        }
      }
    }
    
    // Load projects and add their checks
    const loadedProjects = loadProjectsForChecks(workspaceRoot, config);
    for (const project of loadedProjects) {
      const projectName = project.src ? path.basename(project.src) : 'unknown';
      if (project.checks) {
        for (const check of project.checks) {
          allChecks.push({
            check: check as CheckItem,
            source: 'project',
            sourceName: projectName
          });
        }
      }
    }
    
    if (log) {
      log(`[Step 7] Found ${allChecks.length} check(s) to verify`);
    }
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.error} Failed to load checks: ${err.message}`, 'red');
    if (log) {
      log(`[Step 7] ERROR: Failed to load checks: ${err.message}`);
    }
    const result: VerifyInstallationStepResult = { results: [] };
    markStepCompleted(workspaceRoot, 'verify-installation', result, err.message);
    return result;
  }
  
  // Create check functions for processCheck
  const checkFunctions = createCheckFunctions(workspaceRoot, projectRoot, log, autoYes);
  
  // Filter checks: only verify checks that have a test field and haven't been verified yet
  const checksToVerify = allChecks.filter(({ check }) => {
    // Must have a test field
    if (!check.test || typeof check.test !== 'string' || check.test.trim() === '') {
      return false;
    }
    
    // Skip if already executed (we'll verify it again to ensure it still works)
    // Actually, we want to verify all checks with test fields, even if they were already executed
    // This is the verification step - we're double-checking everything works
    return true;
  });
  
  print(`  ${symbols.info} Verifying ${checksToVerify.length} check(s)...`, 'cyan');
  if (log) {
    log(`[Step 7] Verifying ${checksToVerify.length} check(s)`);
  }
  
  const verificationResults: VerificationResult[] = [];
  let requiredFailed = 0;
  let recomendedFailed = 0;
  
  for (const { check, source, sourceName } of checksToVerify) {
    const checkId = generateCheckId(check);
    const contextName = sourceName || null;
    const contextType = source === 'config' ? 'workspace' : source;
    const requirement = getCheckRequirement(check);
    
    // Run the check using processCheck (with skipInstall=true since we're just verifying)
    const checkResult = await processCheck(
      contextType,
      contextName,
      check,
      {
        workspaceRoot,
        skipInstall: true, // Don't install during verification
        ...checkFunctions
      }
    );
    
    // Create verification result
    const verificationResult: VerificationResult = {
      ...checkResult,
      step: 'verify-installation',
      executedAt: new Date().toISOString()
    };
    
    verificationResults.push(verificationResult);
    
    // Track check execution (update existing or create new)
    trackCheckExecution(workspaceRoot, checkId, 'verify-installation', checkResult);

    // Enforce requirement semantics for verification summary.
    if (checkResult.passed === false) {
      if (requirement === 'required') requiredFailed += 1;
      if (requirement === 'recomended') recomendedFailed += 1;
    }
  }
  
  const passed = verificationResults.filter(r => r.passed === true).length;
  const failed = verificationResults.filter(r => r.passed === false).length;
  const skipped = verificationResults.filter(r => r.skipped === true).length;
  const total = verificationResults.length;
  
  if (requiredFailed === 0) {
    print(`  ${symbols.success} All verifications passed (${passed}/${total - skipped} passed, ${skipped} skipped)`, 'green');
  } else {
    print(`  ${symbols.warning} Verification completed: ${passed}/${total - skipped} passed, ${failed} failed, ${skipped} skipped`, 'yellow');
  }
  
  const result: VerifyInstallationStepResult = { results: verificationResults };
  const errorMsg =
    requiredFailed > 0
      ? `${requiredFailed} required verification check(s) failed`
      : (recomendedFailed > 0 ? `${recomendedFailed} recomended verification check(s) failed (non-blocking)` : undefined);
  markStepCompleted(workspaceRoot, 'verify-installation', verificationResults, errorMsg);
  
  if (log) {
    log(`[Step 7] Completed: ${passed} passed, ${failed} failed (${requiredFailed} required, ${recomendedFailed} recomended), ${skipped} skipped`);
  }
  
  if (requiredFailed > 0) {
    print(`  ${symbols.error} Step 7 failed: ${requiredFailed} required check(s) failed`, 'red');
  } else if (recomendedFailed > 0) {
    print(`  ${symbols.warning} Step 7 completed with warnings: ${recomendedFailed} recomended check(s) failed`, 'yellow');
  } else {
    print(`  ${symbols.success} Step 7 completed`, 'green');
  }
  
  return result;
}

export async function installStep7VerifyInstallation(ctx: InstallContext): Promise<StepOutcome> {
  const res = await runStep7VerifyInstallation(ctx.workspaceRoot, ctx.projectRoot, (m) => ctx.logger.info(m), ctx.autoYes);
  const requiredFailed = res.results.filter((r) => r.passed === false && (r.requirement ?? 'required') === 'required').length;
  if (requiredFailed > 0) {
    return { status: 'failed', error: `${requiredFailed} required verification check(s) failed`, result: res.results };
  }
  return { status: 'ok', result: res.results };
}

