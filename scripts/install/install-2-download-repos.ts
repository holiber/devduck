#!/usr/bin/env node

/**
 * Step 2: Download Repos
 * 
 * Download/clone external repositories into devduck/repo-name
 */

import path from 'path';
import fs from 'fs';
import { readWorkspaceConfigFromRoot } from '../lib/workspace-config.js';
import { print, symbols } from '../utils.js';
import { loadModulesFromRepo, getDevduckVersion } from '../lib/repo-modules.js';
import { markStepCompleted, type RepoResult } from './install-state.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { InstallContext, StepOutcome } from './runner.js';

export interface DownloadReposStepResult {
  repos: RepoResult[];
}

/**
 * Run Step 2: Download repositories
 */
export async function runStep2DownloadRepos(
  workspaceRoot: string,
  log?: (message: string) => void
): Promise<DownloadReposStepResult> {
  if (process.env.DEVDUCK_SUPPRESS_STEP_HEADER !== '1') {
    print(`\n[Step 2] Downloading repositories...`, 'cyan');
  }
  if (log) {
    log(`[Step 2] Starting repository download`);
  }
  
  const { config, configFile } = readWorkspaceConfigFromRoot<WorkspaceConfig>(workspaceRoot);
  
  if (!config) {
    print(`  ${symbols.error} Cannot read workspace config (${path.basename(configFile)})`, 'red');
    if (log) {
      log(`[Step 2] ERROR: Cannot read workspace config (${configFile})`);
    }
    const result: DownloadReposStepResult = { repos: [] };
    markStepCompleted(workspaceRoot, 'download-repos', result, `Cannot read ${path.basename(configFile)}`);
    return result;
  }
  
  const repos: RepoResult[] = [];
  
  if (!config.repos || !Array.isArray(config.repos) || config.repos.length === 0) {
    print(`  ${symbols.info} No repositories to download`, 'cyan');
    if (log) {
      log(`[Step 2] No repositories configured`);
    }
    const result: DownloadReposStepResult = { repos: [] };
    markStepCompleted(workspaceRoot, 'download-repos', result);
    return result;
  }
  
  print(`  ${symbols.info} Downloading ${config.repos.length} repository/repositories...`, 'cyan');
  if (log) {
    log(`[Step 2] Downloading ${config.repos.length} repository/repositories`);
  }
  
  const devduckVersion = getDevduckVersion();
  
  for (const repoUrl of config.repos) {
    try {
      print(`  Loading repository [${repoUrl}]...`, 'cyan');
      if (log) {
        log(`[Step 2] Loading repository: ${repoUrl}`);
      }
      
      const repoModulesPath = await loadModulesFromRepo(repoUrl, workspaceRoot, devduckVersion);
      
      if (fs.existsSync(repoModulesPath)) {
        repos.push({
          url: repoUrl,
          path: repoModulesPath,
          success: true
        });
        print(`  ${symbols.success} Repository loaded: ${repoUrl}`, 'green');
        if (log) {
          log(`[Step 2] Repository loaded successfully: ${repoUrl} -> ${repoModulesPath}`);
        }
      } else {
        repos.push({
          url: repoUrl,
          path: repoModulesPath,
          success: false,
          error: 'Modules directory not found after download'
        });
        print(`  ${symbols.error} Repository download failed: ${repoUrl}`, 'red');
        if (log) {
          log(`[Step 2] Repository download failed: ${repoUrl} - modules directory not found`);
        }
      }
    } catch (error) {
      const err = error as Error;
      repos.push({
        url: repoUrl,
        path: '',
        success: false,
        error: err.message
      });
      print(`  ${symbols.error} Repository download failed: ${repoUrl} - ${err.message}`, 'red');
      if (log) {
        log(`[Step 2] Repository download failed: ${repoUrl} - ${err.message}`);
      }
    }
  }
  
  const successCount = repos.filter(r => r.success).length;
  const failCount = repos.filter(r => !r.success).length;
  
  if (failCount === 0) {
    print(`  ${symbols.success} All repositories downloaded successfully (${successCount}/${repos.length})`, 'green');
  } else {
    print(`  ${symbols.warning} Downloaded ${successCount}/${repos.length} repositories (${failCount} failed)`, 'yellow');
  }
  
  const result: DownloadReposStepResult = { repos };
  markStepCompleted(workspaceRoot, 'download-repos', repos);
  
  if (log) {
    log(`[Step 2] Completed: ${successCount} succeeded, ${failCount} failed`);
  }
  
  print(`  ${symbols.success} Step 2 completed`, 'green');
  
  return result;
}

export async function installStep2DownloadRepos(ctx: InstallContext): Promise<StepOutcome> {
  await runStep2DownloadRepos(ctx.workspaceRoot, (m) => ctx.logger.info(m));
  return { status: 'ok' };
}

