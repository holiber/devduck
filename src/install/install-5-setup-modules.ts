#!/usr/bin/env node

/**
 * Step 5: Setup Modules
 * 
 * Run module checks and setup (skip already-run env checks from steps 1 & 4)
 * Execute module hooks (pre-install, install, post-install)
 * Some checks may update .env file if they set env variables
 */

import path from 'path';
import fs from 'fs';
import { readWorkspaceConfigFromRoot } from '../lib/workspace-config.js';
import { print, symbols } from '../utils.js';
import { loadModulesForChecks, createCheckFunctions } from './install-common.js';
import { markStepCompleted, type ModuleResult, getExecutedChecks, trackCheckExecution, generateCheckId } from './install-state.js';
import { loadInstallState } from './install-state.js';
import { processCheck } from './process-check.js';
import { getCheckRequirement } from './types.js';
import { executeHooksForStage, createHookContext } from './module-hooks.js';
import { loadModuleResources } from './module-loader.js';
import { getAllModules, getAllModulesFromDirectory, expandModuleNames, resolveDependencies, mergeModuleSettings } from './module-resolver.js';
import { loadModulesFromRepo, getDevduckVersion } from '../lib/repo-modules.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { CheckItem, CheckResult } from './types.js';
import type { InstallContext, StepOutcome } from './runner.js';

export interface SetupModulesStepResult {
  modules: ModuleResult[];
}

/**
 * Run Step 5: Setup modules
 */
export async function runStep5SetupModules(
  workspaceRoot: string,
  projectRoot: string,
  log?: (message: string) => void,
  autoYes = false
): Promise<SetupModulesStepResult> {
  if (process.env.DEVDUCK_SUPPRESS_STEP_HEADER !== '1') {
    print(`\n[Step 5] Setting up extensions...`, 'cyan');
  }
  if (log) {
    log(`[Step 5] Starting extension setup`);
  }
  
  const { config, configFile } = readWorkspaceConfigFromRoot<WorkspaceConfig>(workspaceRoot);
  
  if (!config) {
    print(`  ${symbols.error} Cannot read workspace config (${path.basename(configFile)})`, 'red');
    if (log) {
      log(`[Step 5] ERROR: Cannot read workspace config (${configFile})`);
    }
    const result: SetupModulesStepResult = { modules: [] };
    markStepCompleted(workspaceRoot, 'setup-modules', result, `Cannot read ${path.basename(configFile)}`);
    return result;
  }
  
  // Load all modules (including from repos)
  let loadedModules: Array<{
    name: string;
    path: string;
    checks?: Array<CheckItem>;
    settings?: Record<string, unknown>;
    [key: string]: unknown;
  }> = [];
  
  try {
    // Load external modules from repos
    const externalModules: Array<{ name: string; path: string; checks?: unknown[]; [key: string]: unknown }> = [];
    if (config.repos && Array.isArray(config.repos)) {
      const devduckVersion = getDevduckVersion();
      
      for (const repoUrl of config.repos) {
        try {
          const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
          const { loadModuleFromPath } = await import('./module-resolver.js');
          if (fs.existsSync(repoModulesPath)) {
            const repoModuleEntries = fs.readdirSync(repoModulesPath, { withFileTypes: true });
            for (const entry of repoModuleEntries) {
              if (entry.isDirectory()) {
                const modulePath = path.join(repoModulesPath, entry.name);
                const module = loadModuleFromPath(modulePath, entry.name);
                if (module) {
                  externalModules.push(module);
                }
              }
            }
          }
        } catch (error) {
          const err = error as Error;
          if (log) {
            log(`[Step 5] Warning: Failed to load modules from ${repoUrl}: ${err.message}`);
          }
        }
      }
    }
    
    // Load all extensions with priority: workspace > projects > external > built-in
    const localModules = getAllModules();
    const workspaceExtensionsDir = path.join(workspaceRoot, 'extensions');
    const workspaceModules = getAllModulesFromDirectory(workspaceExtensionsDir);
    
    const projectsModules: Array<{ name: string; path: string; checks?: unknown[]; [key: string]: unknown }> = [];
    if (config.projects && Array.isArray(config.projects)) {
      for (const project of config.projects) {
        if (typeof project !== 'object' || project === null) continue;
        const projectObj = project as { src?: string };
        const projectName = projectObj.src ? String(projectObj.src).split('/').pop()?.replace(/\.git$/, '') || '' : '';
        const projectPath = path.join(workspaceRoot, 'projects', projectName);
        const projectExtensionsDir = path.join(projectPath, 'extensions');
        if (fs.existsSync(projectExtensionsDir)) {
          const projectModules = getAllModulesFromDirectory(projectExtensionsDir);
          projectsModules.push(...projectModules);
        }
      }
    }
    
    const allModules = [...workspaceModules, ...projectsModules, ...externalModules, ...localModules];
    const moduleNames = expandModuleNames(Array.isArray((config as any).extensions) ? ((config as any).extensions as string[]) : ['*'], allModules);
    const resolvedModules = resolveDependencies(moduleNames, allModules);
    
    // Load module resources
    loadedModules = resolvedModules.map(module => {
      const resources = loadModuleResources(module);
      const mergedSettings = mergeModuleSettings(module, (config as any).extensionSettings as any);
      
      return {
        ...resources,
        settings: mergedSettings,
        checks: module.checks as CheckItem[] | undefined
      };
    });
    
    if (log) {
      log(`[Step 5] Loaded ${loadedModules.length} module(s)`);
    }
  } catch (error) {
    const err = error as Error;
    print(`  ${symbols.error} Failed to load modules: ${err.message}`, 'red');
    if (log) {
      log(`[Step 5] ERROR: Failed to load modules: ${err.message}`);
    }
    const result: SetupModulesStepResult = { modules: [] };
    markStepCompleted(workspaceRoot, 'setup-modules', result, err.message);
    return result;
  }
  
  // Get executed checks to skip already-run env checks
  const executedChecks = getExecutedChecks(workspaceRoot);
  const executedCheckIds = new Set(executedChecks.map(c => c.checkId));
  
  // Create check functions for processCheck
  const checkFunctions = createCheckFunctions(workspaceRoot, projectRoot, log, autoYes);
  
  // Execute module hooks
  print(`  ${symbols.info} Executing module hooks...`, 'cyan');
  if (log) {
    log(`[Step 5] Executing module hooks`);
  }
  
  // Pre-install hooks
  const preInstallContexts = loadedModules.map(module => 
    createHookContext(workspaceRoot, module, loadedModules)
  );
  const preInstallResults = await executeHooksForStage(loadedModules, 'pre-install', preInstallContexts);
  const preInstallFailures = preInstallResults.filter(r => !r.success);
  if (preInstallFailures.length > 0) {
    const first = preInstallFailures[0];
    const details = (first.errors && first.errors.length > 0 ? first.errors.join(', ') : (first.message || 'unknown error'));
    const msg = `Module ${first.module} ${first.hook} hook failed: ${details}`;
    print(`  ${symbols.error} ${msg}`, 'red');
    if (log) log(`[Step 5] ERROR: ${msg}`);
    const result: SetupModulesStepResult = { modules: [] };
    markStepCompleted(workspaceRoot, 'setup-modules', result, msg);
    return result;
  }
  
  // Install hooks
  const installContexts = loadedModules.map(module => 
    createHookContext(workspaceRoot, module, loadedModules)
  );
  const installHookResults = await executeHooksForStage(loadedModules, 'install', installContexts);
  const installFailures = installHookResults.filter(r => !r.success);
  if (installFailures.length > 0) {
    const first = installFailures[0];
    const details = (first.errors && first.errors.length > 0 ? first.errors.join(', ') : (first.message || 'unknown error'));
    const msg = `Module ${first.module} ${first.hook} hook failed: ${details}`;
    print(`  ${symbols.error} ${msg}`, 'red');
    if (log) log(`[Step 5] ERROR: ${msg}`);
    const result: SetupModulesStepResult = { modules: [] };
    markStepCompleted(workspaceRoot, 'setup-modules', result, msg);
    return result;
  }
  
  // Post-install hooks
  const postInstallContexts = loadedModules.map(module => 
    createHookContext(workspaceRoot, module, loadedModules)
  );
  const postInstallResults = await executeHooksForStage(loadedModules, 'post-install', postInstallContexts);
  
  // Check for hook failures
  let postInstallFailed = false;
  for (const result of postInstallResults) {
    if (result.success && result.message) {
      if (log) {
        log(`[Step 5] Module ${result.module}: ${result.message}`);
      }
    } else if (!result.success) {
      postInstallFailed = true;
      if (result.errors && result.errors.length > 0) {
        if (log) {
          log(`[Step 5] Module ${result.module} errors: ${result.errors.join(', ')}`);
        }
        print(`  ${symbols.error} Module ${result.module} post-install hook failed: ${result.errors.join(', ')}`, 'red');
      } else {
        if (log) {
          log(`[Step 5] Module ${result.module} post-install hook failed`);
        }
        print(`  ${symbols.error} Module ${result.module} post-install hook failed`, 'red');
      }
    }
  }
  
  if (postInstallFailed) {
    const errorMsg = 'One or more post-install hooks failed';
    print(`  ${symbols.error} ${errorMsg}`, 'red');
    if (log) {
      log(`[Step 5] ERROR: ${errorMsg}`);
    }
    const result: SetupModulesStepResult = { modules: [] };
    markStepCompleted(workspaceRoot, 'setup-modules', result, errorMsg);
    return result;
  }
  
  // Run module checks (skip already-run env checks)
  const moduleResults: ModuleResult[] = [];
  
  for (const module of loadedModules) {
    if (!module.checks || module.checks.length === 0) {
      moduleResults.push({
        name: module.name,
        path: module.path,
        checks: [],
        hooksExecuted: {
          'pre-install': true,
          'install': true,
          'post-install': true
        }
      });
      continue;
    }
    
    const moduleChecks: CheckResult[] = [];
    
    for (const check of module.checks) {
      // Skip checks that were already executed in steps 1 or 4
      const checkId = generateCheckId(check);
      if (executedCheckIds.has(checkId)) {
        if (log) {
          log(`[Step 5] Skipping already-executed check: ${check.name || checkId}`);
        }
        continue;
      }
      
      // Run the check using processCheck
      const requirement = getCheckRequirement(check);
      const checkResult = await processCheck(
        'module',
        module.name,
        check,
        {
          workspaceRoot,
          ...checkFunctions
        }
      );
      
      moduleChecks.push(checkResult);
      
      // Track check execution
      trackCheckExecution(workspaceRoot, checkId, 'setup-modules', checkResult);

      // Enforce requirement semantics
      if (checkResult.passed === false) {
        if (requirement === 'required') {
          const msg = `Required check failed: ${checkResult.name}`;
          print(`  ${symbols.error} ${msg}`, 'red');
          if (log) log(`[Step 5] ERROR: ${msg}`);
          // Persist partial results for debugging.
          const result: SetupModulesStepResult = { modules: moduleResults.concat([{ name: module.name, path: module.path, checks: moduleChecks, hooksExecuted: { 'pre-install': true, 'install': true, 'post-install': true } }]) };
          markStepCompleted(workspaceRoot, 'setup-modules', result.modules, msg);
          return result;
        }
        if (requirement === 'recomended') {
          print(`  ${symbols.warning} Recomended check failed (non-blocking): ${checkResult.name}`, 'yellow');
          if (log) log(`[Step 5] WARNING: Recomended check failed (non-blocking): ${checkResult.name}`);
        }
      }
    }
    
    moduleResults.push({
      name: module.name,
      path: module.path,
      checks: moduleChecks,
      hooksExecuted: {
        'pre-install': true,
        'install': true,
        'post-install': true
      }
    });
  }
  
  const result: SetupModulesStepResult = { modules: moduleResults };
  markStepCompleted(workspaceRoot, 'setup-modules', moduleResults);
  
  if (log) {
    log(`[Step 5] Completed: ${moduleResults.length} module(s) processed`);
  }
  
  print(`  ${symbols.success} Step 5 completed`, 'green');
  
  return result;
}

export async function installStep5SetupModules(ctx: InstallContext): Promise<StepOutcome<{ installedModules: Record<string, string> }>> {
  const res = await runStep5SetupModules(
    ctx.workspaceRoot,
    ctx.projectRoot,
    (m) => ctx.logger.info(m),
    ctx.autoYes
  );

  const step = loadInstallState(ctx.workspaceRoot).steps['setup-modules'];
  if (step?.error) {
    return { status: 'failed', error: step.error };
  }

  const installedModules: Record<string, string> = {};
  if (res?.modules) {
    for (const mod of res.modules) {
      if (mod?.name && mod?.path) installedModules[mod.name] = mod.path;
    }
  }

  return { status: 'ok', result: { installedModules } };
}

