#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { resolveCorePaths } = require('../../../scripts/lib/devduck-paths');
const { findWorkspaceRoot } = require('../../../scripts/lib/workspace-root');

const { coreUtilsPath } = resolveCorePaths({ cwd: process.cwd(), moduleDir: __dirname });
const { executeCommand } = require(coreUtilsPath);

/**
 * Load workspace configuration
 */
function loadWorkspaceConfig() {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    return null;
  }
  
  const configPath = path.join(workspaceRoot, 'workspace.config.json');
  if (!fs.existsSync(configPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to parse workspace.config.json: ${error.message}`);
    return null;
  }
}

/**
 * Parse repository URL and determine type
 */
function parseRepoUrl(repoUrl) {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('Invalid repository URL');
  }

  const trimmed = repoUrl.trim();

  // Arcadia formats
  if (trimmed.startsWith('arc://')) {
    return {
      type: 'arc',
      normalized: trimmed.replace(/^arc:\/\//, '')
    };
  }

  if (trimmed.startsWith('a.yandex-team.ru/arc/')) {
    return {
      type: 'arc',
      normalized: trimmed.replace(/^a\.yandex-team\.ru\/arc\//, '')
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
function getProjectName(src) {
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
 * @param {string} repoPath - Path to Git repository
 * @returns {string} Base branch name ('main' or 'master')
 */
function getGitBaseBranch(repoPath) {
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
 * @param {string} repoPath - Path to git repository
 * @returns {object} Status object with hasChanges, files arrays
 */
function checkGitStatus(repoPath) {
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
  const uncommitted = [];
  const untracked = [];
  
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
 * @returns {object} Status object with hasChanges, files arrays
 */
function checkArcStatus() {
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
  const uncommitted = [];
  const untracked = [];
  
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
function parseArcStatusFull(output) {
  const lines = output.split('\n');
  const uncommitted = [];
  const untracked = [];
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
      
      let fileName = null;
      let status = null;
      
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
function main() {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    console.error('Error: Workspace root not found. Make sure you are in a devduck workspace.');
    process.exit(1);
  }
  
  const workspaceConfig = loadWorkspaceConfig();
  if (!workspaceConfig) {
    console.error('Error: Failed to load workspace.config.json');
    process.exit(1);
  }
  
  const result = {
    ok: false,
    gitRepos: [],
    arcStatus: null,
    errors: [],
    operations: []
  };
  
  // Check all git repositories
  if (workspaceConfig.projects && Array.isArray(workspaceConfig.projects)) {
    for (const project of workspaceConfig.projects) {
      const projectSrc = project.src || project.path_in_arcadia;
      if (!projectSrc) continue;
      
      const repoInfo = parseRepoUrl(projectSrc);
      if (repoInfo.type !== 'git') continue;
      
      const projectName = getProjectName(projectSrc);
      const projectPath = path.join(workspaceRoot, 'projects', projectName);
      
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
    
    const projectPath = path.join(workspaceRoot, 'projects', gitRepo.projectName);
    
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
if (require.main === module) {
  main();
}

module.exports = {
  main,
  checkGitStatus,
  checkArcStatus,
  getGitBaseBranch
};

