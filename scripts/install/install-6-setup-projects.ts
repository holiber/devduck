#!/usr/bin/env node

/**
 * Step 6: Setup Projects
 * 
 * Run project checks (skip already-run env checks)
 */

import path from 'path';
import { readWorkspaceConfigFromRoot } from '../lib/workspace-config.js';
import { readEnvFile } from '../lib/env.js';
import { print, symbols } from '../utils.js';
import { createCheckFunctions } from './install-common.js';
import { markStepCompleted, type ProjectResult, getExecutedChecks, trackCheckExecution, generateCheckId } from './install-state.js';
import { processCheck } from './process-check.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { CheckItem, CheckResult } from './types.js';
import type { InstallContext, StepOutcome } from './runner.js';

export interface SetupProjectsStepResult {
  projects: ProjectResult[];
}

/**
 * Get project name from src
 */
function getProjectName(src: string | undefined): string {
  if (!src) return 'unknown';
  
  // Handle arc:// URLs
  if (src.startsWith('arc://')) {
    const pathPart = src.replace('arc://', '');
    return path.basename(pathPart);
  }
  
  // Handle GitHub URLs
  if (src.includes('github.com/')) {
    const match = src.match(/github\.com\/[^\/]+\/([^\/]+)/);
    if (match) {
      return match[1].replace('.git', '');
    }
  }
  
  // Handle regular paths
  return path.basename(src);
}

/**
 * Run Step 6: Setup projects
 */
export async function runStep6SetupProjects(
  workspaceRoot: string,
  projectRoot: string,
  log?: (message: string) => void,
  autoYes = false
): Promise<SetupProjectsStepResult> {
  print(`\n[Step 6] Setting up projects...`, 'cyan');
  if (log) {
    log(`[Step 6] Starting project setup`);
  }
  
  const { config, configFile } = readWorkspaceConfigFromRoot<WorkspaceConfig>(workspaceRoot);
  
  if (!config) {
    print(`  ${symbols.error} Cannot read workspace config (${path.basename(configFile)})`, 'red');
    if (log) {
      log(`[Step 6] ERROR: Cannot read workspace config (${configFile})`);
    }
    const result: SetupProjectsStepResult = { projects: [] };
    markStepCompleted(workspaceRoot, 'setup-projects', result, `Cannot read ${path.basename(configFile)}`);
    return result;
  }
  
  if (!config.projects || !Array.isArray(config.projects) || config.projects.length === 0) {
    print(`  ${symbols.info} No projects to setup`, 'cyan');
    if (log) {
      log(`[Step 6] No projects configured`);
    }
    const result: SetupProjectsStepResult = { projects: [] };
    markStepCompleted(workspaceRoot, 'setup-projects', result);
    return result;
  }
  
  // Get executed checks to skip already-run env checks
  const executedChecks = getExecutedChecks(workspaceRoot);
  const executedCheckIds = new Set(executedChecks.map(c => c.checkId));
  
  // Create check functions for processCheck
  const checkFunctions = createCheckFunctions(workspaceRoot, projectRoot, log, autoYes);
  
  // Load projects from step 3 results (if available)
  const { loadInstallState } = await import('./install-state.js');
  const state = loadInstallState(workspaceRoot);
  const downloadedProjects = state.steps['download-projects']?.result || [];
  
  // Create a map of project names to their downloaded info
  const projectMap = new Map<string, { symlink: ProjectResult['symlink'] }>();
  for (const proj of downloadedProjects) {
    projectMap.set(proj.name, { symlink: proj.symlink });
  }
  
  print(`  ${symbols.info} Processing ${config.projects.length} project(s)...`, 'cyan');
  if (log) {
    log(`[Step 6] Processing ${config.projects.length} project(s)`);
  }
  
  const env = readEnvFile(path.join(workspaceRoot, '.env'));
  const projects: ProjectResult[] = [];
  
  // Tier execution order
  const TIER_ORDER = ['pre-install', 'install', 'live', 'pre-test', 'tests'];
  const DEFAULT_TIER = 'pre-install';
  
  for (const project of config.projects) {
    const projectName = getProjectName(project.src);
    
    print(`  Processing project: ${projectName}`, 'cyan');
    if (log) {
      log(`[Step 6] Processing project: ${projectName}`);
    }
    
    // Get symlink info from step 3
    const downloadedInfo = projectMap.get(projectName);
    
    const result: ProjectResult = {
      name: projectName,
      src: project.src,
      symlink: downloadedInfo?.symlink || null,
      checks: []
    };
    
    if (!project.checks || !Array.isArray(project.checks) || project.checks.length === 0) {
      projects.push(result);
      continue;
    }
    
    // Group checks by tier
    const checksByTier: Record<string, CheckItem[]> = {};
    for (const check of project.checks) {
      const tier = (check as { tier?: string }).tier || DEFAULT_TIER;
      if (!checksByTier[tier]) {
        checksByTier[tier] = [];
      }
      checksByTier[tier].push(check as CheckItem);
    }
    
    // Run checks tier by tier
    for (const tier of TIER_ORDER) {
      const tierChecks = checksByTier[tier];
      if (!tierChecks || tierChecks.length === 0) {
        continue;
      }
      
      if (log) {
        log(`[Step 6] [${projectName}] Tier: ${tier} - ${tierChecks.length} check(s)`);
      }
      
      for (const check of tierChecks) {
        // Skip checks that were already executed in steps 1, 4, or 5
        const checkId = generateCheckId(check);
        if (executedCheckIds.has(checkId)) {
          if (log) {
            log(`[Step 6] Skipping already-executed check: ${check.name || checkId}`);
          }
          continue;
        }
        
        // Skip check if skip=true in config
        if ((check as { skip?: boolean }).skip === true) {
          print(`    ${symbols.warning} ${check.name}: skipped`, 'yellow');
          if (log) {
            log(`[Step 6] CHECK SKIPPED: ${check.name}`);
          }
          result.checks.push({
            name: check.name,
            description: check.description || '',
            passed: null,
            skipped: true,
            tier: tier
          });
          continue;
        }
        
        // Run the check using processCheck
        const checkResult = await processCheck(
          'project',
          projectName,
          check,
          {
            workspaceRoot,
            tier,
            ...checkFunctions
          }
        );
        
        result.checks.push(checkResult);
        
        // Track check execution
        trackCheckExecution(workspaceRoot, checkId, 'setup-projects', checkResult);
      }
    }
    
    projects.push(result);
  }
  
  const result: SetupProjectsStepResult = { projects };
  markStepCompleted(workspaceRoot, 'setup-projects', projects);
  
  if (log) {
    log(`[Step 6] Completed: ${projects.length} project(s) processed`);
  }
  
  print(`  ${symbols.success} Step 6 completed`, 'green');
  
  return result;
}

export async function installStep6SetupProjects(ctx: InstallContext): Promise<StepOutcome> {
  await runStep6SetupProjects(ctx.workspaceRoot, ctx.projectRoot, (m) => ctx.logger.info(m), ctx.autoYes);
  return { status: 'ok' };
}

