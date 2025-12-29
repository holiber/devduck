#!/usr/bin/env node

/**
 * Step 3: Download Projects
 * 
 * Clone/link projects into projects/ folder
 */

import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { readWorkspaceConfigFromRoot } from '../lib/workspace-config.js';
import { readEnvFile } from '../lib/env.js';
import { print, symbols } from '../utils.js';
import { markStepCompleted, type ProjectResult } from './install-state.js';
import type { WorkspaceConfig } from '../schemas/workspace-config.zod.js';
import type { InstallContext, StepOutcome } from './runner.js';

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
 * Resolve project src to workspace path
 */
function resolveProjectSrcToWorkspacePath(projectSrc: string | undefined, workspaceRoot: string): string | null {
  if (!projectSrc || typeof projectSrc !== 'string') return null;
  // Treat relative paths as relative to the workspace root
  return path.isAbsolute(projectSrc) ? projectSrc : path.resolve(workspaceRoot, projectSrc);
}

/**
 * Check if path is an existing directory
 */
function isExistingDirectory(dirPath: string | undefined): boolean {
  try {
    if (!dirPath) return false;
    if (!fs.existsSync(dirPath)) return false;
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Create symlink for Arcadia project
 */
function createProjectSymlink(
  projectName: string,
  pathInArcadia: string,
  workspaceRoot: string,
  env: Record<string, string>
): { success: boolean; path: string; target: string; existed?: boolean; created?: boolean; error?: string } {
  const projectsDir = path.join(workspaceRoot, 'projects');
  const symlinkPath = path.join(projectsDir, projectName);
  
  // Get ARCADIA path from env
  let arcadiaPath = env.ARCADIA || process.env.ARCADIA || '~/arcadia';
  arcadiaPath = arcadiaPath.replace(/^~/, process.env.HOME || '');
  
  const targetPath = path.join(arcadiaPath, pathInArcadia);
  
  try {
    // Check if symlink already exists
    if (fs.existsSync(symlinkPath)) {
      // Check if it's a symlink
      if (fs.lstatSync(symlinkPath).isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(symlinkPath);
        if (existingTarget === targetPath) {
          return { success: true, path: symlinkPath, target: targetPath, existed: true };
        } else {
          // Remove old symlink
          fs.unlinkSync(symlinkPath);
        }
      } else {
        // It's a directory, remove it
        fs.rmSync(symlinkPath, { recursive: true, force: true });
      }
    }
    
    // Check if target exists
    if (!fs.existsSync(targetPath)) {
      return { success: false, path: symlinkPath, target: targetPath, error: 'Target path does not exist' };
    }
    
    // Create symlink
    fs.symlinkSync(targetPath, symlinkPath);
    
    return { success: true, path: symlinkPath, target: targetPath, created: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, path: symlinkPath, target: targetPath, error: err.message };
  }
}

/**
 * Create symlink to target folder (for local-folder projects)
 */
function createProjectSymlinkToTarget(
  projectName: string,
  targetPath: string,
  workspaceRoot: string
): { success: boolean; path: string; target: string; existed?: boolean; created?: boolean; error?: string } {
  const projectsDir = path.join(workspaceRoot, 'projects');
  const symlinkPath = path.join(projectsDir, projectName);
  const resolvedTarget = path.resolve(targetPath);
  
  try {
    // Check if symlink already exists
    if (fs.existsSync(symlinkPath)) {
      if (fs.lstatSync(symlinkPath).isSymbolicLink()) {
        const existingTarget = fs.readlinkSync(symlinkPath);
        // readlink may return relative paths; normalize before comparing
        const existingResolved = path.resolve(path.dirname(symlinkPath), existingTarget);
        if (existingResolved === resolvedTarget) {
          return { success: true, path: symlinkPath, target: resolvedTarget, existed: true };
        }
        fs.unlinkSync(symlinkPath);
      } else {
        // It's a directory or file, remove it
        fs.rmSync(symlinkPath, { recursive: true, force: true });
      }
    }
    
    if (!fs.existsSync(resolvedTarget)) {
      return { success: false, path: symlinkPath, target: resolvedTarget, error: 'Target path does not exist' };
    }
    
    const stats = fs.statSync(resolvedTarget);
    if (!stats.isDirectory()) {
      return { success: false, path: symlinkPath, target: resolvedTarget, error: 'Target path is not a directory' };
    }
    
    fs.symlinkSync(resolvedTarget, symlinkPath);
    return { success: true, path: symlinkPath, target: resolvedTarget, created: true };
  } catch (error) {
    const err = error as Error;
    return { success: false, path: symlinkPath, target: resolvedTarget, error: err.message };
  }
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
  if (process.env.DEVDUCK_SUPPRESS_STEP_HEADER !== '1') {
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
    const result: DownloadProjectsStepResult = { projects: [] };
    markStepCompleted(workspaceRoot, 'download-projects', result, `Cannot read ${path.basename(configFile)}`);
    return result;
  }
  
  if (!config.projects || !Array.isArray(config.projects) || config.projects.length === 0) {
    print(`  ${symbols.info} No projects to download`, 'cyan');
    if (log) {
      log(`[Step 3] No projects configured`);
    }
    const result: DownloadProjectsStepResult = { projects: [] };
    markStepCompleted(workspaceRoot, 'download-projects', result);
    return result;
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
  
  const env = readEnvFile(path.join(workspaceRoot, '.env'));
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
    
    // Arcadia projects: create symlink into Arcadia checkout
    if (project.src.startsWith('arc://')) {
      print(`    Creating symlink...`, 'cyan');
      // Remove arc:// prefix if present
      const pathForSymlink = project.src.replace(/^arc:\/\//, '');
      const symlinkResult = createProjectSymlink(projectName, pathForSymlink, workspaceRoot, env);
      
      if (symlinkResult.success) {
        const action = symlinkResult.existed ? 'exists' : 'created';
        print(`    ${symbols.success} Symlink ${action}: projects/${projectName} -> ${symlinkResult.target}`, 'green');
        result.symlink = {
          path: `projects/${projectName}`,
          target: symlinkResult.target,
          created: symlinkResult.created || false
        };
      } else {
        print(`    ${symbols.error} Symlink failed: ${symlinkResult.error}`, 'red');
        result.symlink = {
          path: `projects/${projectName}`,
          target: symlinkResult.target,
          error: symlinkResult.error
        };
      }
    } else if (project.src && isExistingDirectory(resolveProjectSrcToWorkspacePath(project.src, workspaceRoot))) {
      // Local-folder projects - create symlink in projects/ directly to the folder path
      const resolvedLocalPath = resolveProjectSrcToWorkspacePath(project.src, workspaceRoot);
      print(`    Creating symlink...`, 'cyan');
      const symlinkResult = createProjectSymlinkToTarget(projectName, resolvedLocalPath, workspaceRoot);
      
      if (symlinkResult.success) {
        const action = symlinkResult.existed ? 'exists' : 'created';
        print(`    ${symbols.success} Symlink ${action}: projects/${projectName} -> ${symlinkResult.target}`, 'green');
        result.symlink = {
          path: `projects/${projectName}`,
          target: symlinkResult.target,
          created: symlinkResult.created || false
        };
      } else {
        print(`    ${symbols.error} Symlink failed: ${symlinkResult.error}`, 'red');
        result.symlink = {
          path: `projects/${projectName}`,
          target: symlinkResult.target,
          error: symlinkResult.error
        };
      }
    } else if (project.src && (project.src.includes('github.com') || project.src.startsWith('git@'))) {
      // GitHub projects - clone to projects/ directory
      const projectPath = path.join(projectsDir, projectName);
      
      // Check if already cloned
      if (fs.existsSync(projectPath) && fs.existsSync(path.join(projectPath, '.git'))) {
        // Update existing clone
        print(`    ${symbols.info} Updating existing git repository...`, 'cyan');
        if (log) {
          log(`[Step 3] Updating existing git repository: ${projectPath}`);
        }
        const pullResult = spawnSync('git', ['pull'], {
          cwd: projectPath,
          encoding: 'utf8'
        });
        
        if (pullResult.status === 0) {
          print(`    ${symbols.success} Repository updated: projects/${projectName}`, 'green');
          if (log) {
            log(`[Step 3] Repository updated successfully: ${projectPath}`);
          }
          result.symlink = {
            path: `projects/${projectName}`,
            target: projectPath,
            exists: true,
            updated: pullResult.status === 0
          };
        } else {
          print(`    ${symbols.warning} Failed to update repository, using existing version`, 'yellow');
          if (log) {
            log(`[Step 3] Failed to update repository: ${pullResult.stderr || pullResult.stdout}`);
          }
          result.symlink = {
            path: `projects/${projectName}`,
            target: projectPath,
            exists: true,
            updated: false
          };
        }
      } else {
        // Clone repository
        print(`    ${symbols.info} Cloning repository...`, 'cyan');
        if (log) {
          log(`[Step 3] Cloning repository: ${project.src} to ${projectPath}`);
        }
        
        // Convert github.com/user/repo to https://github.com/user/repo.git
        // Use HTTPS for CI compatibility (no SSH keys required)
        let gitUrl = project.src;
        if (gitUrl.includes('github.com') && !gitUrl.startsWith('git@') && !gitUrl.startsWith('http')) {
          gitUrl = `https://github.com/${gitUrl.replace(/^github\.com\//, '').replace(/\.git$/, '')}.git`;
        }
        
        const cloneResult = spawnSync('git', ['clone', gitUrl, projectPath], {
          encoding: 'utf8',
          stdio: 'inherit'
        });
        
        if (cloneResult.status === 0) {
          print(`    ${symbols.success} Repository cloned: projects/${projectName}`, 'green');
          if (log) {
            log(`[Step 3] Repository cloned successfully: ${projectPath}`);
          }
          result.symlink = {
            path: `projects/${projectName}`,
            target: projectPath,
            created: true
          };
        } else {
          print(`    ${symbols.error} Failed to clone repository: ${cloneResult.stderr || cloneResult.stdout}`, 'red');
          if (log) {
            log(`[Step 3] Failed to clone repository: ${cloneResult.stderr || cloneResult.stdout}`);
          }
          result.symlink = {
            path: `projects/${projectName}`,
            target: projectPath,
            error: `Failed to clone: ${cloneResult.stderr || cloneResult.stdout}`
          };
        }
      }
    } else {
      // Other project types - no action needed
      print(`    ${symbols.info} Project type not supported for automatic setup`, 'cyan');
      result.symlink = {
        path: null,
        target: null,
        note: 'Project type not supported for automatic setup'
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

