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
import { WorkspaceConfigSchema } from '../schemas/workspace-config.zod.js';
import { z } from 'zod';
import type { InstallContext, StepOutcome } from './runner.js';

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
      const existingPath = path.join(projectsDir, projectName);
      if (fs.existsSync(existingPath)) {
        print(`    ${symbols.info} Project already exists in projects/${projectName}, skipping (no relink / no cleanup)`, 'cyan');
        result.symlink = {
          path: `projects/${projectName}`,
          target: null,
          existed: true
        };
        projects.push(result);
        continue;
      }
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
    } else {
      const resolvedLocalPath = resolveProjectSrcToWorkspacePath(project.src, workspaceRoot);
      if (project.src && resolvedLocalPath && isExistingDirectory(resolvedLocalPath)) {
        const existingPath = path.join(projectsDir, projectName);
        if (fs.existsSync(existingPath)) {
          print(
            `    ${symbols.info} Project already exists in projects/${projectName}, skipping (no relink / no cleanup)`,
            'cyan'
          );
          result.symlink = {
            path: `projects/${projectName}`,
            target: null,
            existed: true
          };
          projects.push(result);
          continue;
        }

        // Local-folder projects - create symlink in projects/ directly to the folder path
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

        // Never touch existing paths under projects/
        if (fs.existsSync(projectPath)) {
          print(
            `    ${symbols.info} Repository already exists in projects/${projectName}, skipping (no git pull / no reset / no cleanup)`,
            'cyan'
          );
          result.symlink = { path: `projects/${projectName}`, target: projectPath, existed: true };
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
        error: 'Project type not supported for automatic setup'
      };
      }
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

