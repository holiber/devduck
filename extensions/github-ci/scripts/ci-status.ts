#!/usr/bin/env node

import path from 'path';
import https from 'https';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { resolveCorePaths } from '@barducks/sdk';
import { findWorkspaceRoot } from '@barducks/sdk';
import { getWorkspaceConfigFilePath, readWorkspaceConfigFile } from '@barducks/sdk';
import type { ExecuteCommandResult } from '@barducks/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { coreUtilsPath, coreEnvPath } = resolveCorePaths({ cwd: process.cwd(), moduleDir: __dirname });

// Dynamic imports
const utilsModule = await import(coreUtilsPath);
const envModule = await import(coreEnvPath);

const executeCommand = utilsModule.executeCommand as (command: string, options?: { cwd?: string }) => ExecuteCommandResult;
const getEnv = envModule.getEnv as (name: string, options?: { envPath?: string }) => string;

interface PRInfo {
  number: number;
  url: string;
  title: string;
  branch: string;
  sha: string;
}

interface CheckInfo {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

interface RepoInfo {
  owner: string;
  repo: string;
}

interface CheckSummary {
  total: number;
  success: number;
  failure: number;
  pending: number;
  cancelled: number;
  skipped: number;
}

/**
 * Get current branch name
 */
function getCurrentBranch(repoPath: string): string | null {
  const result = executeCommand('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
  if (!result.success) {
    return null;
  }
  return result.output.trim();
}

/**
 * Get PR info for current branch using gh CLI
 */
export function getPRInfoViaCLI(repoPath: string, branch: string): PRInfo | null {
  const ghResult = executeCommand(`gh pr view ${branch} --json number,url,title,headRefName,headSha 2>/dev/null`, { cwd: repoPath });
  if (!ghResult.success) {
    return null;
  }
  
  try {
    const pr = JSON.parse(ghResult.output) as { number: number; url: string; title: string; headRefName: string; headSha: string };
    return {
      number: pr.number,
      url: pr.url,
      title: pr.title,
      branch: pr.headRefName,
      sha: pr.headSha
    };
  } catch (e) {
    return null;
  }
}

/**
 * Get PR info via GitHub API
 */
export function getPRInfoViaAPI(repoPath: string, branch: string, token: string): Promise<PRInfo | null> {
  return new Promise((resolve) => {
    // First, get repo owner and name
    const remoteResult = executeCommand('git remote get-url origin', { cwd: repoPath });
    if (!remoteResult.success) {
      resolve(null);
      return;
    }
    
    const remoteMatch = remoteResult.output.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
    if (!remoteMatch) {
      resolve(null);
      return;
    }
    
    const owner = remoteMatch[1];
    const repo = remoteMatch[2].replace(/\.git$/, '');
    
    // Get PRs for the branch
    const apiPath = `/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`;
    
    const req = https.request(
      {
        method: 'GET',
        hostname: 'api.github.com',
        path: apiPath,
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'barducks-github-ci',
          'Accept': 'application/vnd.github.v3+json'
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const prs = JSON.parse(data) as Array<{ number: number; html_url: string; title: string; head: { ref: string; sha: string } }>;
              if (prs.length > 0) {
                const pr = prs[0];
                resolve({
                  number: pr.number,
                  url: pr.html_url,
                  title: pr.title,
                  branch: pr.head.ref,
                  sha: pr.head.sha
                });
              } else {
                resolve(null);
              }
            } catch (e) {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        });
      }
    );
    
    req.on('error', () => {
      resolve(null);
    });
    
    req.end();
  });
}

/**
 * Get checks via gh CLI
 */
export function getChecksViaCLI(repoPath: string, prNumber: number): CheckInfo[] | null {
  const ghResult = executeCommand(`gh pr checks ${prNumber} --json name,status,conclusion,url 2>/dev/null`, { cwd: repoPath });
  if (!ghResult.success) {
    return null;
  }
  
  try {
    const checks = JSON.parse(ghResult.output) as Array<{ name: string; status: string; conclusion: string | null; url: string }>;
    return checks.map(check => ({
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      url: check.url
    }));
  } catch (e) {
    return null;
  }
}

/**
 * Get checks via GitHub API
 */
export function getChecksViaAPI(owner: string, repo: string, sha: string, token: string): Promise<CheckInfo[]> {
  return new Promise((resolve) => {
    const apiPath = `/repos/${owner}/${repo}/commits/${sha}/check-runs`;
    
    const req = https.request(
      {
        method: 'GET',
        hostname: 'api.github.com',
        path: apiPath,
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'barducks-github-ci',
          'Accept': 'application/vnd.github.v3+json'
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data) as { check_runs?: Array<{ name: string; status: string; conclusion: string | null; html_url: string }> };
              const checks = response.check_runs || [];
              resolve(checks.map(check => ({
                name: check.name,
                status: check.status,
                conclusion: check.conclusion,
                url: check.html_url
              })));
            } catch (e) {
              resolve([]);
            }
          } else {
            resolve([]);
          }
        });
      }
    );
    
    req.on('error', () => {
      resolve([]);
    });
    
    req.end();
  });
}

/**
 * Get repo owner and name from remote
 */
function getRepoInfo(repoPath: string): RepoInfo | null {
  const remoteResult = executeCommand('git remote get-url origin', { cwd: repoPath });
  if (!remoteResult.success) {
    return null;
  }
  
  const remoteMatch = remoteResult.output.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
  if (!remoteMatch) {
    return null;
  }
  
  return {
    owner: remoteMatch[1],
    repo: remoteMatch[2].replace(/\.git$/, '')
  };
}

/**
 * Calculate summary from checks
 */
export function calculateSummary(checks: CheckInfo[]): CheckSummary {
  const summary: CheckSummary = {
    total: checks.length,
    success: 0,
    failure: 0,
    pending: 0,
    cancelled: 0,
    skipped: 0
  };
  
  for (const check of checks) {
    if (check.status === 'completed') {
      if (check.conclusion === 'success') {
        summary.success++;
      } else if (check.conclusion === 'failure') {
        summary.failure++;
      } else if (check.conclusion === 'cancelled') {
        summary.cancelled++;
      } else if (check.conclusion === 'skipped') {
        summary.skipped++;
      }
    } else if (check.status === 'queued' || check.status === 'in_progress') {
      summary.pending++;
    }
  }
  
  return summary;
}

/**
 * Main function
 */
export async function main(): Promise<void> {
  // Determine repository path
  // First, try to find if we're in a project directory
  let repoPath = process.cwd();
  const workspaceRoot = findWorkspaceRoot();
  
  // Check if current directory is a git repo
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    // Try to find GitHub repos in workspace
    if (workspaceRoot) {
      const configPath = getWorkspaceConfigFilePath(workspaceRoot);
      if (fs.existsSync(configPath)) {
        try {
          const config = readWorkspaceConfigFile<{ projects?: Array<{ src?: string; [key: string]: unknown }> }>(
            configPath
          );
          if (config.projects && Array.isArray(config.projects)) {
            // Find first GitHub repo
            for (const project of config.projects) {
              const projectSrc = project.src;
              if (!projectSrc || !projectSrc.includes('github.com')) continue;
              
              const match = projectSrc.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
              if (match) {
                const projectName = match[2].replace(/\.git$/, '');
                const candidatePath = path.join(workspaceRoot, 'projects', projectName);
                if (fs.existsSync(path.join(candidatePath, '.git'))) {
                  repoPath = candidatePath;
                  break;
                }
              }
            }
          }
        } catch (e) {
          // Ignore config errors
        }
      }
    }
  }
  
  // Verify it's a git repo
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Not a git repository. Run this script from a git repository or workspace with GitHub projects.'
    }, null, 2));
    process.exit(1);
  }
  
  // Get current branch
  const branch = getCurrentBranch(repoPath);
  if (!branch) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Failed to get current branch'
    }, null, 2));
    process.exit(1);
  }
  
  // Get PR info
  let prInfo = getPRInfoViaCLI(repoPath, branch);
  
  if (!prInfo) {
    // Try GitHub API
    const token = process.env.GITHUB_TOKEN || getEnv('GITHUB_TOKEN');
    if (token) {
      prInfo = await getPRInfoViaAPI(repoPath, branch, token);
    }
  }
  
  if (!prInfo) {
    console.log(JSON.stringify({
      ok: false,
      branch: branch,
      error: 'No PR found for current branch',
      message: `No open pull request found for branch: ${branch}`
    }, null, 2));
    process.exit(1);
  }
  
  // Get checks
  let checks = getChecksViaCLI(repoPath, prInfo.number);
  
  if (!checks) {
    // Try GitHub API
    const token = process.env.GITHUB_TOKEN || getEnv('GITHUB_TOKEN');
    if (token) {
      const repoInfo = getRepoInfo(repoPath);
      if (repoInfo) {
        checks = await getChecksViaAPI(repoInfo.owner, repoInfo.repo, prInfo.sha, token);
      }
    }
  }
  
  if (!checks) {
    checks = [];
  }
  
  // Calculate summary
  const summary = calculateSummary(checks);
  
  // Output result
  const result = {
    ok: true,
    branch: branch,
    pr: {
      number: prInfo.number,
      url: prInfo.url,
      title: prInfo.title,
      sha: prInfo.sha
    },
    checks: checks,
    summary: summary
  };
  
  console.log(JSON.stringify(result, null, 2));
  
  // Exit with error code if there are failures
  if (summary.failure > 0) {
    process.exit(1);
  }
  
  process.exit(0);
}

// Run main function if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const err = error as { message?: string };
    console.error(JSON.stringify({
      ok: false,
      error: err.message || 'Unknown error'
    }, null, 2));
    process.exit(1);
  });
}

