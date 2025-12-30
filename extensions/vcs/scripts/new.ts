#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { resolveCorePaths } from '@barducks/sdk';
import { findWorkspaceRoot } from '@barducks/sdk';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from '@barducks/sdk';
import type { ExecuteCommandResult } from '@barducks/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { coreUtilsPath } = resolveCorePaths({ cwd: process.cwd(), moduleDir: __dirname });

// Dynamic import for executeCommand
const utilsModule = await import(coreUtilsPath);
const executeCommand = utilsModule.executeCommand as (command: string, options?: { cwd?: string }) => ExecuteCommandResult;

interface RepoUrlParseResult {
  type: 'git' | 'arc';
  normalized: string;
}

interface GitStatusResult {
  hasChanges: boolean;
  uncommitted: Array<{ file: string; status: string }>;
  untracked: string[];
  error?: string | null;
}

interface ArcStatusResult {
  hasChanges: boolean;
  uncommitted: Array<{ file: string; status: string }>;
  untracked: string[];
  error?: string | null;
}

interface WorkspaceConfig {
  projects?: Array<{ src?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * Load workspace configuration
 */
function loadWorkspaceConfig(): WorkspaceConfig | null {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    return null;
  }
  
  const configPath = getWorkspaceConfigFilePath(workspaceRoot);
  if (!fs.existsSync(configPath)) {
    return null;
  }
  
  return readWorkspaceConfigFile<WorkspaceConfig>(configPath);
}

/**
 * Parse repository URL and determine type
 */
function parseRepoUrl(repoUrl: string): RepoUrlParseResult {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('Invalid repository URL');
  }

  const trimmed = repoUrl.trim();

  // Arc working copy formats
  if (trimmed.startsWith('arc://')) {
    return {
      type: 'arc',
      normalized: trimmed.replace(/^arc:\/\//, '')
    };
  }

  // Git formats
  if (trimmed.startsWith('git@')) {
    return {
      type: 'git',
      normalized: trimmed
    };
  }

  if (trimmed.includes('github.com')) {
    // github.com/user/repo or https://github.com/user/repo
    let normalized = trimmed;
    if (normalized.startsWith('https://')) {
      normalized = normalized.replace(/^https:\/\//, '');
    }
    if (normalized.startsWith('http://')) {
      normalized = normalized.replace(/^http:\/\//, '');
    }
    return {
      type: 'git',
      normalized: normalized
    };
  }

  // Default: assume it's a git URL
  return {
    type: 'git',
    normalized: trimmed
  };
}

/**
 * Get project name from src path
 */
function getProjectName(src: string | undefined): string | null {
  if (!src) return null;
  
  // For github.com/user/repo format
  const githubMatch = src.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
  if (githubMatch) {
    return githubMatch[2].replace(/\.git$/, '');
  }
  
  // For arc://junk/user/repo format
  if (src.startsWith('arc://')) {
    const parts = src.replace(/^arc:\/\//, '').split('/');
    return parts[parts.length - 1];
  }
  
  // Fallback: use last part of path
  const parts = src.split('/');
  return parts[parts.length - 1].replace(/\.git$/, '');
}

/**
 * Get base branch for Git repository (main or master)
 * @param repoPath - Path to Git repository
 * @returns Base branch name ('main' or 'master')
 */
export function getGitBaseBranch(repoPath: string): string {
  if (!fs.existsSync(repoPath) || !fs.existsSync(path.join(repoPath, '.git'))) {
    return 'main'; // Default fallback
  }
  
  // Check if 'main' branch exists
  const mainCheck = executeCommand('git rev-parse --verify main 2>/dev/null', { cwd: repoPath });
  if (mainCheck.success) {
    return 'main';
  }
  
  // Check if 'master' branch exists
  const masterCheck = executeCommand('git rev-parse --verify master 2>/dev/null', { cwd: repoPath });
  if (masterCheck.success) {
    return 'master';
  }
  
  // Default to 'main' if neither exists
  return 'main';
}

/**
 * Check git repository status
 * @param repoPath - Path to git repository
 * @returns Status object with hasChanges, files arrays
 */
export function checkGitStatus(repoPath: string): GitStatusResult {
  const statusResult = executeCommand('git status --porcelain', { cwd: repoPath });
  
  if (!statusResult.success) {
    return {
      hasChanges: false,
      uncommitted: [],
      untracked: [],
      error: statusResult.error
    };
  }
  
  const output = statusResult.output.trim();
  if (!output) {
    return {
      hasChanges: false,
      uncommitted: [],
      untracked: []
    };
  }
  
  const lines = output.split('\n').filter(l => l.trim());
  const uncommitted: Array<{ file: string; status: string }> = [];
  const untracked: string[] = [];
  
  for (const line of lines) {
    // Git status format: XY filename
    // X = status in index, Y = status in working tree
    // ? = untracked, space = unchanged
    const match = line.match(/^([AMDRT? ]{2})\s+(.+)$/);
    if (match) {
      const statusCode = match[1];
      const filePath = match[2].trim();
      
      // Check if untracked (??)
      if (statusCode === '??') {
        untracked.push(filePath);
      } else {
        // Uncommitted change (staged or unstaged)
        uncommitted.push({
          file: filePath,
          status: statusCode
        });
      }
    }
  }
  
  return {
    hasChanges: uncommitted.length > 0 || untracked.length > 0,
    uncommitted,
    untracked
  };
}

/**
 * Check arc working copy status
 * @returns Status object with hasChanges, files arrays
 */
export function checkArcStatus(): ArcStatusResult {
  const statusResult = executeCommand('arc status --short');
  
  if (!statusResult.success) {
    // Try full status as fallback
    const fullStatusResult = executeCommand('arc status');
    if (!fullStatusResult.success) {
      return {
        hasChanges: false,
        uncommitted: [],
        untracked: [],
        error: fullStatusResult.error
      };
    }
    
    // Parse full status output
    return parseArcStatusFull(fullStatusResult.output);
  }
  
  const output = statusResult.output.trim();
  if (!output) {
    return {
      hasChanges: false,
      uncommitted: [],
      untracked: []
    };
  }
  
  const lines = output.split('\n').filter(l => l.trim());
  const uncommitted: Array<{ file: string; status: string }> = [];
  const untracked: string[] = [];
  
  for (const line of lines) {
    // Arc status --short format: XY filename
    const match = line.match(/^([AMDRT? ]{2})\s+(.+)$/);
    if (match) {
      const statusCode = match[1];
      const filePath = match[2].trim();
      
      // Check if untracked (??)
      if (statusCode === '??') {
        untracked.push(filePath);
      } else {
        // Uncommitted change
        uncommitted.push({
          file: filePath,
          status: statusCode
        });
      }
    }
  }
  
  return {
    hasChanges: uncommitted.length > 0 || untracked.length > 0,
    uncommitted,
    untracked
  };
}

/**
 * Parse full arc status output (fallback when --short is not available)
 */
function parseArcStatusFull(output: string): ArcStatusResult {
  const lines = output.split('\n');
  const uncommitted: Array<{ file: string; status: string }> = [];
  const untracked: string[] = [];
  let inUnstagedSection = false;
  let inUntrackedSection = false;
  let inStagedSection = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check for section headers
    if (trimmed.includes('Changes not staged for commit:')) {
      inUnstagedSection = true;
      inUntrackedSection = false;
      inStagedSection = false;
      continue;
    }
    
    if (trimmed.includes('Untracked files:')) {
      inUntrackedSection = true;
      inUnstagedSection = false;
      inStagedSection = false;
      continue;
    }
    
    if (trimmed.includes('Changes to be committed:')) {
      inStagedSection = true;
      inUnstagedSection = false;
      inUntrackedSection = false;
      continue;
    }
    
    // Skip empty lines, instructions, and branch info
    if (!trimmed || 
        trimmed.startsWith('(') || 
        trimmed.startsWith('use "arc') ||
        trimmed.startsWith('On branch') ||
        trimmed.startsWith('Your branch') ||
        trimmed.includes('nothing to commit') ||
        trimmed.includes('no changes added')) {
      continue;
    }
    
    // Parse file entries
    if (inUnstagedSection || inStagedSection) {
      const modifiedMatch = trimmed.match(/^modified:\s+(.+)$/);
      const deletedMatch = trimmed.match(/^deleted:\s+(.+)$/);
      const newFileMatch = trimmed.match(/^new file:\s+(.+)$/);
      const renamedMatch = trimmed.match(/^renamed:\s+(.+)$/);
      
      let fileName: string | null = null;
      let status: string | null = null;
      
      if (modifiedMatch) {
        fileName = modifiedMatch[1].trim();
        status = 'M';
      } else if (deletedMatch) {
        fileName = deletedMatch[1].trim();
        status = 'D';
      } else if (newFileMatch) {
        fileName = newFileMatch[1].trim();
        status = 'A';
      } else if (renamedMatch) {
        fileName = renamedMatch[1].trim();
        status = 'R';
      }
      
      if (fileName && status) {
        uncommitted.push({
          file: fileName,
          status: status
        });
      }
      continue;
    }
    
    // Parse untracked files
    if (inUntrackedSection) {
      if ((trimmed.includes('/') || trimmed.includes('.')) && !trimmed.includes('arc ')) {
        untracked.push(trimmed);
      }
    }
  }
  
  return {
    hasChanges: uncommitted.length > 0 || untracked.length > 0,
    uncommitted,
    untracked
  };
}

/**
 * Main function
 */
export function main(): void {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    console.error('Error: Workspace root not found. Make sure you are in a barducks workspace.');
    process.exit(1);
  }
  
  const workspaceConfig = loadWorkspaceConfig();
  if (!workspaceConfig) {
    console.error('Error: Failed to load workspace config');
    process.exit(1);
  }
  
  interface Result {
    ok: boolean;
    gitRepos: Array<{
      projectName: string | null;
      repo: string;
      exists?: boolean;
      isGit?: boolean;
      baseBranch?: string;
      hasChanges?: boolean;
      uncommitted?: Array<{ file: string; status: string }>;
      untracked?: string[];
      error?: string | null;
      status?: string;
      [key: string]: unknown;
    }>;
    arcStatus: {
      hasChanges: boolean;
      uncommitted: Array<{ file: string; status: string }>;
      untracked: string[];
      error?: string | null;
    } | null;
    errors: Array<{
      repo: string;
      projectName?: string | null;
      type?: string;
      uncommitted?: Array<{ file: string; status: string }>;
      untracked?: string[];
      operation?: string;
      error?: string | null;
      [key: string]: unknown;
    }>;
    operations: Array<{
      repo: string;
      projectName?: string | null;
      operation: string;
      branch?: string;
      success: boolean;
      [key: string]: unknown;
    }>;
  }

  const result: Result = {
    ok: false,
    gitRepos: [],
    arcStatus: null,
    errors: [],
    operations: []
  };
  
  // Check all git repositories
  if (workspaceConfig.projects && Array.isArray(workspaceConfig.projects)) {
    for (const project of workspaceConfig.projects) {
      const projectSrc = project.src;
      if (!projectSrc) continue;
      
      const repoInfo = parseRepoUrl(projectSrc);
      if (repoInfo.type !== 'git') continue;
      
      const projectName = getProjectName(projectSrc);
      const projectPath = path.join(workspaceRoot, 'projects', projectName || '');
      
      // Check if project directory exists and has .git
      if (!fs.existsSync(projectPath)) {
        result.gitRepos.push({
          projectName,
          repo: repoInfo.normalized,
          exists: false,
          status: 'not_found'
        });
        continue;
      }
      
      const gitPath = path.join(projectPath, '.git');
      if (!fs.existsSync(gitPath)) {
        result.gitRepos.push({
          projectName,
          repo: repoInfo.normalized,
          exists: true,
          isGit: false,
          status: 'not_git_repo'
        });
        continue;
      }
      
      // Check git status
      const gitStatus = checkGitStatus(projectPath);
      const baseBranch = getGitBaseBranch(projectPath);
      
      result.gitRepos.push({
        projectName,
        repo: repoInfo.normalized,
        exists: true,
        isGit: true,
        baseBranch,
        hasChanges: gitStatus.hasChanges,
        uncommitted: gitStatus.uncommitted,
        untracked: gitStatus.untracked,
        error: gitStatus.error
      });
      
      // Add to errors if there are changes
      if (gitStatus.hasChanges) {
        result.errors.push({
          repo: `git:${repoInfo.normalized}`,
          projectName,
          type: 'git',
          uncommitted: gitStatus.uncommitted,
          untracked: gitStatus.untracked
        });
      }
    }
  }
  
  // Check arc status
  const arcStatus = checkArcStatus();
  result.arcStatus = {
    hasChanges: arcStatus.hasChanges,
    uncommitted: arcStatus.uncommitted,
    untracked: arcStatus.untracked,
    error: arcStatus.error
  };
  
  if (arcStatus.hasChanges) {
    result.errors.push({
      repo: 'arc:current-working-copy',
      type: 'arc',
      uncommitted: arcStatus.uncommitted,
      untracked: arcStatus.untracked
    });
  }
  
  // If there are errors, output and exit
  if (result.errors.length > 0) {
    result.ok = false;
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
  
  // All checks passed - perform operations
  result.ok = true;
  
  // Checkout and pull git repositories
  for (const gitRepo of result.gitRepos) {
    if (!gitRepo.exists || !gitRepo.isGit || !gitRepo.baseBranch) continue;
    
    const projectPath = path.join(workspaceRoot, 'projects', gitRepo.projectName || '');
    
    // Checkout base branch
    const checkoutResult = executeCommand(`git checkout ${gitRepo.baseBranch}`, { cwd: projectPath });
    if (!checkoutResult.success) {
      result.errors.push({
        repo: `git:${gitRepo.repo}`,
        projectName: gitRepo.projectName,
        operation: 'checkout',
        error: checkoutResult.error
      });
      result.ok = false;
      continue;
    }
    
    result.operations.push({
      repo: `git:${gitRepo.repo}`,
      projectName: gitRepo.projectName,
      operation: 'checkout',
      branch: gitRepo.baseBranch,
      success: true
    });
    
    // Pull latest changes
    const pullResult = executeCommand('git pull', { cwd: projectPath });
    if (!pullResult.success) {
      result.errors.push({
        repo: `git:${gitRepo.repo}`,
        projectName: gitRepo.projectName,
        operation: 'pull',
        error: pullResult.error
      });
      result.ok = false;
      continue;
    }
    
    result.operations.push({
      repo: `git:${gitRepo.repo}`,
      projectName: gitRepo.projectName,
      operation: 'pull',
      success: true
    });
  }
  
  // Checkout trunk and pull for arc
  const arcCheckoutResult = executeCommand('arc checkout trunk');
  if (!arcCheckoutResult.success) {
    result.errors.push({
      repo: 'arc:current-working-copy',
      operation: 'checkout',
      error: arcCheckoutResult.error
    });
    result.ok = false;
  } else {
    result.operations.push({
      repo: 'arc:current-working-copy',
      operation: 'checkout',
      branch: 'trunk',
      success: true
    });
    
    const arcPullResult = executeCommand('arc pull');
    if (!arcPullResult.success) {
      result.errors.push({
        repo: 'arc:current-working-copy',
        operation: 'pull',
        error: arcPullResult.error
      });
      result.ok = false;
    } else {
      result.operations.push({
        repo: 'arc:current-working-copy',
        operation: 'pull',
        success: true
      });
    }
  }
  
  // Output result
  console.log(JSON.stringify(result, null, 2));
  
  // Exit with appropriate code
  process.exit(result.ok ? 0 : 1);
}

// Run main function if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

