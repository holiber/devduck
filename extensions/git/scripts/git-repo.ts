#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Repo, type RepoStats, type DiffResult, type ChangedFilesResult, type CommitsResult, type BranchResult, type PRStatusResult, type CreatePRResult, type BranchExistsResult } from '../../vcs/scripts/repo.js';
import { resolveCorePaths } from '../../../scripts/lib/barducks-paths.js';
import type { ExecuteCommandResult } from '../../../scripts/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { coreUtilsPath, coreEnvPath } = resolveCorePaths({ cwd: process.cwd(), moduleDir: __dirname });

// Import utils dynamically - tsx supports .ts imports
const utilsModule = await import(coreUtilsPath);
const envModule = await import(coreEnvPath);

const executeCommand = utilsModule.executeCommand as (command: string, options?: { cwd?: string }) => ExecuteCommandResult;
const getEnv = envModule.getEnv as (name: string, options?: { envPath?: string }) => string;

/**
 * Parse commit log output
 */
function parseCommitLog(output: string): Array<{ hash: string; message: string }> {
  const commits: Array<{ hash: string; message: string }> = [];
  const lines = output.split('\n').filter(l => l.trim());
  
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
    if (match) {
      commits.push({
        hash: match[1],
        message: match[2].trim()
      });
    }
  }
  
  return commits;
}

/**
 * Git repository implementation
 */
export class GitRepo extends Repo {
  /**
   * Check if repository exists and is a valid Git repository
   */
  _checkRepo(): { ok: boolean; error?: string } {
    if (!fs.existsSync(this.repoPath) || !fs.existsSync(path.join(this.repoPath, '.git'))) {
      return { ok: false, error: 'Not a git repository' };
    }
    return { ok: true };
  }

  /**
   * Get repository status
   */
  async stats(): Promise<RepoStats> {
    const check = this._checkRepo();
    if (!check.ok) {
      return check;
    }

    // Get current branch
    const branchResult = executeCommand('git rev-parse --abbrev-ref HEAD', { cwd: this.repoPath });
    const currentBranch = branchResult.success ? branchResult.output.trim() : null;

    // Get commits
    const commitsResult = executeCommand('git log --oneline -20', { cwd: this.repoPath });
    const commits = commitsResult.success ? parseCommitLog(commitsResult.output) : [];

    // Check for unpushed commits
    const unpushedResult = executeCommand('git log --oneline @{u}..HEAD 2>/dev/null', { cwd: this.repoPath });
    const unpushedCommits = unpushedResult.success && unpushedResult.output 
      ? parseCommitLog(unpushedResult.output) 
      : [];

    // Get status of changed files
    const statusResult = executeCommand('git status --porcelain', { cwd: this.repoPath });
    const files: Array<{ file: string; status: string; statusName?: string }> = [];
    if (statusResult.success && statusResult.output) {
      const lines = statusResult.output.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const match = line.match(/^([AMDRT? ]{2})\s+(.+)$/);
        if (match) {
          const statusCode = match[1];
          const filePath = match[2].trim();
          if (statusCode === '??') {
            files.push({ file: filePath, status: '?', statusName: 'untracked' });
          } else {
            files.push({ 
              file: filePath, 
              status: statusCode.trim(),
              statusName: statusCode[0] === 'A' ? 'added' : 
                         statusCode[0] === 'M' ? 'modified' : 
                         statusCode[0] === 'D' ? 'deleted' : 
                         statusCode[0] === 'R' ? 'renamed' : 'unknown'
            });
          }
        }
      }
    }

    return {
      ok: true,
      exists: true,
      currentBranch,
      commits,
      unpushedCommits,
      hasUnpushedCommits: unpushedCommits.length > 0,
      files,
      hasChanges: files.length > 0
    };
  }

  /**
   * Get diff content relative to base branch
   */
  async diff(baseBranch?: string): Promise<DiffResult> {
    const check = this._checkRepo();
    if (!check.ok) {
      return check;
    }

    const base = baseBranch || (await this.getBaseBranch()).branch;
    if (!base) {
      return { ok: false, error: 'Failed to get base branch' };
    }

    const diffResult = executeCommand(`git diff ${base}`, { cwd: this.repoPath });
    if (!diffResult.success) {
      return { ok: false, error: diffResult.error || 'Failed to get diff' };
    }

    return {
      ok: true,
      diff: diffResult.output,
      baseBranch: base
    };
  }

  /**
   * Get list of changed files relative to base branch
   */
  async getChangedFiles(baseBranch?: string): Promise<ChangedFilesResult> {
    const check = this._checkRepo();
    if (!check.ok) {
      return { ok: false, files: [], error: check.error };
    }

    const base = baseBranch || (await this.getBaseBranch()).branch;
    if (!base) {
      return { ok: false, files: [], error: 'Failed to get base branch' };
    }

    const diffResult = executeCommand(`git diff --name-status ${base}...HEAD`, { cwd: this.repoPath });
    if (!diffResult.success) {
      return { ok: false, files: [], error: diffResult.error || 'Failed to get changed files' };
    }

    const files: Array<{ status: string; file: string }> = [];
    const lines = diffResult.output.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const match = line.match(/^([AMDR])\s+(.+)$/);
      if (match) {
        files.push({
          status: match[1],
          file: match[2].trim()
        });
      }
    }

    return { ok: true, files, error: null };
  }

  /**
   * Get list of commits relative to base branch
   */
  async getCommits(baseBranch?: string): Promise<CommitsResult> {
    const check = this._checkRepo();
    if (!check.ok) {
      return { ok: false, commits: [], error: check.error };
    }

    const base = baseBranch || (await this.getBaseBranch()).branch;
    if (!base) {
      return { ok: false, commits: [], error: 'Failed to get base branch' };
    }

    const result = executeCommand(`git log --oneline ${base}..HEAD`, { cwd: this.repoPath });
    if (!result.success) {
      return { ok: false, commits: [], error: result.error || 'Failed to get commits' };
    }

    const commits = parseCommitLog(result.output);
    return { ok: true, commits, error: null };
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<BranchResult> {
    const check = this._checkRepo();
    if (!check.ok) {
      return check;
    }

    const branchResult = executeCommand('git rev-parse --abbrev-ref HEAD', { cwd: this.repoPath });
    if (!branchResult.success) {
      return { ok: false, branch: null, error: branchResult.error || 'Failed to get current branch' };
    }

    return {
      ok: true,
      branch: branchResult.output.trim()
    };
  }

  /**
   * Get base branch name (main or master)
   */
  async getBaseBranch(): Promise<BranchResult> {
    const check = this._checkRepo();
    if (!check.ok) {
      return { ok: false, branch: 'main', error: check.error };
    }

    // Check if 'main' branch exists
    const mainCheck = executeCommand('git rev-parse --verify main 2>/dev/null', { cwd: this.repoPath });
    if (mainCheck.success) {
      return { ok: true, branch: 'main' };
    }

    // Check if 'master' branch exists
    const masterCheck = executeCommand('git rev-parse --verify master 2>/dev/null', { cwd: this.repoPath });
    if (masterCheck.success) {
      return { ok: true, branch: 'master' };
    }

    // Default to 'main' if neither exists
    return { ok: true, branch: 'main' };
  }

  /**
   * Check if PR exists for the given branch
   */
  async getPRStatus(branch: string): Promise<PRStatusResult> {
    const check = this._checkRepo();
    if (!check.ok) {
      return { exists: false, pr: null, error: check.error };
    }

    // Try using gh CLI
    const ghResult = executeCommand(`gh pr view ${branch} --json number,url,title 2>/dev/null`, { cwd: this.repoPath });
    if (ghResult.success) {
      try {
        const pr = JSON.parse(ghResult.output) as { number: number; url: string; title: string };
        return {
          exists: true,
          pr: {
            id: pr.number,
            url: pr.url,
            title: pr.title
          }
        };
      } catch (e) {
        // Not JSON, might be error message
      }
    }

    return { exists: false, pr: null };
  }

  /**
   * Create a pull request
   */
  async createPR(branch: string, title: string, description: string): Promise<CreatePRResult> {
    const check = this._checkRepo();
    if (!check.ok) {
      return { ok: false, url: null, error: check.error };
    }

    // Try using gh CLI first
    const escapedDescription = description.replace(/"/g, '\\"');
    const ghResult = executeCommand(`gh pr create --title "${title}" --body "${escapedDescription}" --head ${branch}`, { cwd: this.repoPath });
    if (ghResult.success) {
      // Extract PR URL from output
      const urlMatch = ghResult.output.match(/https:\/\/github\.com\/[^\s]+/);
      return {
        ok: true,
        url: urlMatch ? urlMatch[0] : null,
        method: 'gh-cli'
      };
    }

    // Fallback: use GitHub API if GITHUB_TOKEN is available
    const token = process.env.GITHUB_TOKEN || getEnv('GITHUB_TOKEN');
    if (!token) {
      return { ok: false, url: null, error: 'gh CLI not available and GITHUB_TOKEN not set' };
    }

    // Get repo owner and name from remote
    const remoteResult = executeCommand('git remote get-url origin', { cwd: this.repoPath });
    if (!remoteResult.success) {
      return { ok: false, url: null, error: 'Cannot get remote URL' };
    }

    const remoteMatch = remoteResult.output.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
    if (!remoteMatch) {
      return { ok: false, url: null, error: 'Cannot parse remote URL' };
    }

    // GitHub API implementation would go here
    return { ok: false, url: null, error: 'GitHub API implementation needed' };
  }

  /**
   * Check if branch exists
   */
  async branchExists(branchName: string): Promise<BranchExistsResult> {
    const check = this._checkRepo();
    if (!check.ok) {
      return { ok: false, exists: false, error: check.error };
    }

    const result = executeCommand(`git rev-parse --verify ${branchName} 2>/dev/null`, { cwd: this.repoPath });
    return {
      ok: true,
      exists: result.success
    };
  }
}

