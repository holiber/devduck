#!/usr/bin/env node

/**
 * Step 3: Download Projects
 * 
 * Clone/link projects into projects/ folder
 */

import path from 'path';
import fs from 'fs';
import { readWorkspaceConfigFromRoot } from '../lib/workspace-config.js';
import { readEnvFile } from '../lib/env.js';
import { print, symbols } from '../utils.js';
import { markStepCompleted, type ProjectResult } from './install-state.js';
import { WorkspaceConfigSchema } from '../schemas/workspace-config.zod.js';
import { z } from 'zod';
import type { InstallContext, StepOutcome } from './runner.js';
import { installWithProvider } from '../lib/extension/installer-runtime.js';

type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

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

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export interface DownloadProjectsStepResult {
  projects: ProjectResult[];
}

/**
 * Run Step 3: Download/clone projects
 */
export async function runStep3DownloadProjects(
  workspaceRoot: string,
  log?: (message: string) => void
): Promise<DownloadProjectsStepResult> {
  if (process.env.BARDUCKS_SUPPRESS_STEP_HEADER !== '1') {
    print(`\n[Step 3] Downloading projects...`, 'cyan');
  }
  if (log) {
    log(`[Step 3] Starting project download/clone`);
  }
  
  const { config, configFile } = readWorkspaceConfigFromRoot<WorkspaceConfig>(workspaceRoot);
  
  if (!config) {
    print(`  ${symbols.error} Cannot read workspace config (${path.basename(configFile)})`, 'red');
    if (log) {
      log(`[Step 3] ERROR: Cannot read workspace config (${configFile})`);
    }
    const projects: ProjectResult[] = [];
    markStepCompleted(workspaceRoot, 'download-projects', projects, `Cannot read ${path.basename(configFile)}`);
    return { projects };
  }
  
  if (!config.projects || !Array.isArray(config.projects) || config.projects.length === 0) {
    print(`  ${symbols.info} No projects to download`, 'cyan');
    if (log) {
      log(`[Step 3] No projects configured`);
    }
    const projects: ProjectResult[] = [];
    markStepCompleted(workspaceRoot, 'download-projects', projects);
    return { projects };
  }
  
  // Ensure projects directory exists
  const projectsDir = path.join(workspaceRoot, 'projects');
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
    if (log) {
      log(`[Step 3] Created projects directory: ${projectsDir}`);
    }
  }
  
  print(`  ${symbols.info} Processing ${config.projects.length} project(s)...`, 'cyan');
  if (log) {
    log(`[Step 3] Processing ${config.projects.length} project(s)`);
  }
  
  const projects: ProjectResult[] = [];
  
  for (const project of config.projects) {
    const projectName = getProjectName(project.src);
    
    print(`  Processing project: ${projectName}`, 'cyan');
    if (log) {
      log(`[Step 3] Processing project: ${projectName} (${project.src})`);
    }
    
    const result: ProjectResult = {
      name: projectName,
      src: project.src,
      symlink: null,
      checks: []
    };
    
    if (!project.src || typeof project.src !== 'string') {
      print(`    ${symbols.warning} Project is missing required field: src`, 'yellow');
      if (log) {
        log(`[Step 3] Project skipped: missing src field`);
      }
      result.symlink = {
        path: null,
        target: null,
        error: 'Missing required field: src'
      };
      projects.push(result);
      continue;
    }
    
    const projectPath = path.join(projectsDir, projectName);
    try {
      ensureDir(projectsDir);
      await installWithProvider({
        src: project.src,
        dest: projectPath,
        kind: 'project',
        force: false,
        workspaceRoot,
        quiet: true
      });
      result.symlink = {
        path: `projects/${projectName}`,
        target: projectPath,
        created: !fs.existsSync(projectPath) ? true : undefined
      };
      print(`    ${symbols.success} Installed: projects/${projectName}`, 'green');
    } catch (e) {
      const err = e as Error;
      print(`    ${symbols.error} Install failed: ${err.message}`, 'red');
      result.symlink = {
        path: `projects/${projectName}`,
        target: projectPath,
        error: err.message
      };
    }
    
    projects.push(result);
  }
  
  const successCount = projects.filter(p => p.symlink && !p.symlink.error).length;
  const failCount = projects.filter(p => p.symlink && p.symlink.error).length;
  
  if (failCount === 0) {
    print(`  ${symbols.success} All projects processed successfully (${successCount}/${projects.length})`, 'green');
  } else {
    print(`  ${symbols.warning} Processed ${successCount}/${projects.length} projects (${failCount} failed)`, 'yellow');
  }
  
  const result: DownloadProjectsStepResult = { projects };
  markStepCompleted(workspaceRoot, 'download-projects', projects);
  
  if (log) {
    log(`[Step 3] Completed: ${successCount} succeeded, ${failCount} failed`);
  }
  
  print(`  ${symbols.success} Step 3 completed`, 'green');
  
  return result;
}

export async function installStep3DownloadProjects(ctx: InstallContext): Promise<StepOutcome> {
  await runStep3DownloadProjects(ctx.workspaceRoot, (m) => ctx.logger.info(m));
  return { status: 'ok' };
}

