#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { CI, type CISetupOptions, type CISetupResult, type CICheckResult } from '../../ci/scripts/ci.js';
import { resolveCorePaths } from '../../../scripts/lib/devduck-paths.js';
import type { ExecuteCommandResult } from '../../../scripts/utils.js';
import type { Repo } from '../../vcs/scripts/repo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { coreUtilsPath, coreEnvPath } = resolveCorePaths({ cwd: process.cwd(), moduleDir: __dirname });

// Dynamic imports
const utilsModule = await import(coreUtilsPath);
const envModule = await import(coreEnvPath);

const executeCommand = utilsModule.executeCommand as (command: string, options?: { cwd?: string }) => ExecuteCommandResult;
const getEnv = envModule.getEnv as (name: string, options?: { envPath?: string }) => string;

interface CheckInfo {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  failureReason?: string | null;
  failureTitle?: string | null;
  hasAnnotations?: boolean;
  annotationsUrl?: string;
  annotationsCount?: number;
  failureDetails?: string[];
  [key: string]: unknown;
}

interface CheckSummary {
  total: number;
  success: number;
  failure: number;
  pending: number;
  cancelled: number;
  skipped: number;
}

interface RepoInfo {
  owner: string;
  repo: string;
}

interface Annotation {
  path?: string;
  start_line?: number;
  message: string;
  [key: string]: unknown;
}

/**
 * Calculate summary from checks
 */
function calculateSummary(checks: CheckInfo[]): CheckSummary {
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
      } else if (check.conclusion === 'failure' || check.conclusion === 'action_required') {
        summary.failure++;
      } else if (check.conclusion === 'cancelled') {
        summary.cancelled++;
      } else if (check.conclusion === 'skipped') {
        summary.skipped++;
      } else if (check.conclusion === 'neutral') {
        // Neutral checks don't affect merge status, count as success for summary
        summary.success++;
      }
    } else if (check.status === 'queued' || check.status === 'in_progress') {
      summary.pending++;
    }
  }
  
  return summary;
}

/**
 * Get annotations for a check run
 */
function getCheckAnnotations(owner: string, repo: string, checkRunId: string, token: string): Promise<Annotation[]> {
  return new Promise((resolve) => {
    const apiPath = `/repos/${owner}/${repo}/check-runs/${checkRunId}/annotations`;
    
    const req = https.request(
      {
        method: 'GET',
        hostname: 'api.github.com',
        path: apiPath,
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'devduck-github-ci',
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
              const annotations = JSON.parse(data) as Annotation[];
              resolve(annotations);
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
 * Get checks via GitHub API
 */
function getChecksViaAPI(owner: string, repo: string, sha: string, token: string): Promise<CheckInfo[]> {
  return new Promise(async (resolve) => {
    const apiPath = `/repos/${owner}/${repo}/commits/${sha}/check-runs`;
    
    const req = https.request(
      {
        method: 'GET',
        hostname: 'api.github.com',
        path: apiPath,
        headers: {
          'Authorization': `token ${token}`,
          'User-Agent': 'devduck-github-ci',
          'Accept': 'application/vnd.github.v3+json'
        }
      },
      async (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', async () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data) as { check_runs?: Array<{
                name: string;
                status: string;
                conclusion: string | null;
                html_url: string;
                id: string;
                annotations_count?: number;
                annotations_url?: string;
                output?: {
                  summary?: string;
                  text?: string;
                  title?: string;
                  annotations_count?: number;
                };
              }> };
              const checks = response.check_runs || [];
              
              // Process checks and get annotations for failing ones
              const processedChecks = await Promise.all(checks.map(async (check) => {
                const checkData: CheckInfo = {
                  name: check.name,
                  status: check.status,
                  conclusion: check.conclusion || (check.status === 'completed' ? 'neutral' : null),
                  url: check.html_url
                };
                
                // Get failure reason if check failed
                if (check.conclusion === 'failure' || check.conclusion === 'action_required') {
                  // Extract error information from output
                  if (check.output) {
                    // Try to get summary first, then text, then title
                    const summary = check.output.summary;
                    const text = check.output.text;
                    const title = check.output.title;
                    
                    // Combine available information
                    let failureReason: string | null = null;
                    if (summary) {
                      failureReason = summary;
                      if (text && text !== summary) {
                        failureReason += '\n\n' + text;
                      }
                    } else if (text) {
                      failureReason = text;
                    }
                    
                    checkData.failureReason = failureReason;
                    checkData.failureTitle = title || null;
                  }
                  
                  // Get annotations (specific error lines) if available
                  if (check.annotations_count && check.annotations_count > 0 && check.id) {
                    checkData.hasAnnotations = true;
                    checkData.annotationsUrl = check.annotations_url;
                    checkData.annotationsCount = check.annotations_count;
                    
                    // Fetch annotations to get detailed error messages
                    const annotations = await getCheckAnnotations(owner, repo, check.id, token);
                    if (annotations.length > 0) {
                      // Combine annotation messages
                      const annotationMessages = annotations.map(ann => {
                        const location = ann.path ? `${ann.path}:${ann.start_line || ''}` : '';
                        return location ? `${location}: ${ann.message}` : ann.message;
                      });
                      checkData.failureDetails = annotationMessages;
                      
                      // If no failureReason from output, use first annotation
                      if (!checkData.failureReason && annotationMessages.length > 0) {
                        checkData.failureReason = annotationMessages[0];
                      }
                    }
                  }
                }
                
                return checkData;
              }));
              
              resolve(processedChecks);
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
 * GitHub CI implementation
 */
export class GitHubCI extends CI {
  /**
   * Setup GitHub Actions CI workflow
   */
  async setup(options: CISetupOptions = {}): Promise<CISetupResult> {
    const repoPath = (this.repo as { repoPath: string }).repoPath;
    
    // Check if workflow already exists
    const workflowPath = path.join(repoPath, '.github', 'workflows', 'ci.yml');
    if (fs.existsSync(workflowPath)) {
      return {
        ok: false,
        path: workflowPath,
        error: 'CI workflow already exists'
      };
    }

    // Get test command from package.json or use default
    let testCommand = options.testCommand || 'npm test';
    if (!options.testCommand) {
      const packageJsonPath = path.join(repoPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { scripts?: { test?: string } };
          testCommand = packageJson.scripts?.test || 'npm test';
        } catch (error) {
          // Use default if parsing fails
        }
      }
    }

    // Get base branch
    let baseBranch = options.baseBranch;
    if (!baseBranch) {
      const baseBranchResult = await (this.repo as Repo).getBaseBranch();
      if (baseBranchResult.ok) {
        baseBranch = baseBranchResult.branch || 'main';
      } else {
        baseBranch = 'main';
      }
    }

    // Load workflow template
    const templatePath = path.join(__dirname, '../templates/ci-workflow.yml');
    if (!fs.existsSync(templatePath)) {
      return {
        ok: false,
        error: 'Workflow template not found'
      };
    }

    let template = fs.readFileSync(templatePath, 'utf8');
    
    // Replace placeholders
    template = template
      .replace(/\{\{TEST_COMMAND\}\}/g, testCommand)
      .replace(/branches:\s*\[\s*main,\s*master\s*\]/g, `branches: [ ${baseBranch} ]`);

    // Create directories if needed
    const workflowDir = path.dirname(workflowPath);
    if (!fs.existsSync(workflowDir)) {
      fs.mkdirSync(workflowDir, { recursive: true });
    }

    // Write workflow file
    try {
      fs.writeFileSync(workflowPath, template, 'utf8');
      return {
        ok: true,
        path: workflowPath,
        testCommand,
        baseBranch
      };
    } catch (error) {
      const err = error as { message?: string };
      return {
        ok: false,
        error: `Failed to write workflow file: ${err.message || 'Unknown error'}`
      };
    }
  }

  /**
   * Check merge checks status for PR or branch
   */
  async checkMergeChecks(branchOrPR: string | { number?: number; id?: number; branch?: string; headRefName?: string; sha?: string; headSha?: string }): Promise<CICheckResult> {
    const repoPath = (this.repo as { repoPath: string }).repoPath;
    
    // Determine branch and PR info
    let branch: string | null = null;
    let prNumber: number | null = null;
    let sha: string | null = null;

    if (typeof branchOrPR === 'string') {
      // It's a branch name
      branch = branchOrPR;
      const prStatus = await (this.repo as Repo).getPRStatus(branch);
      if (prStatus.exists && prStatus.pr) {
        prNumber = prStatus.pr.id;
        // Get SHA from PR or current commit
        const currentBranch = await (this.repo as Repo).getCurrentBranch();
        if (currentBranch.ok) {
          // For now, we'll need to get SHA differently
          // This is a limitation - we'd need PR details to get head SHA
        }
      }
    } else if (branchOrPR && typeof branchOrPR === 'object') {
      // It's a PR object
      prNumber = branchOrPR.number || branchOrPR.id || null;
      branch = branchOrPR.branch || branchOrPR.headRefName || null;
      sha = branchOrPR.sha || branchOrPR.headSha || null;
    }

    if (!branch) {
      // Try to get current branch
      const currentBranch = await (this.repo as Repo).getCurrentBranch();
      if (currentBranch.ok) {
        branch = currentBranch.branch || null;
      }
    }

    if (!branch) {
      return {
        ok: false,
        checks: [],
        summary: 'Cannot determine branch or PR',
        error: 'Cannot determine branch or PR'
      };
    }

    // Get checks via GitHub API using commit SHA
    let checks: CheckInfo[] | null = null;
    if (sha) {
      // Try using gh api first (uses gh CLI authentication)
      const repoInfo = getRepoInfo(repoPath);
      if (repoInfo) {
        const ghApiResult = executeCommand(`gh api repos/${repoInfo.owner}/${repoInfo.repo}/commits/${sha}/check-runs 2>/dev/null`, { cwd: repoPath });
        if (ghApiResult.success && ghApiResult.output) {
          try {
            const response = JSON.parse(ghApiResult.output) as { check_runs?: Array<{
              name: string;
              status: string;
              conclusion: string | null;
              html_url: string;
              id: string;
              annotations_count?: number;
              annotations_url?: string;
              output?: {
                summary?: string;
                text?: string;
                title?: string;
                annotations_count?: number;
              };
            }> };
            const checkRuns = response.check_runs || [];
            
            // Process checks and get annotations for failing ones
            checks = await Promise.all(checkRuns.map(async (check) => {
              const checkData: CheckInfo = {
                name: check.name,
                status: check.status,
                conclusion: check.conclusion || (check.status === 'completed' ? 'neutral' : null),
                url: check.html_url
              };
              
              // Get failure reason if check failed
              if (check.conclusion === 'failure' || check.conclusion === 'action_required') {
                // Extract error information from output
                if (check.output) {
                  // Try to get summary first, then text, then title
                  const summary = check.output.summary;
                  const text = check.output.text;
                  const title = check.output.title;
                  
                  // Combine available information
                  let failureReason: string | null = null;
                  if (summary) {
                    failureReason = summary;
                    if (text && text !== summary) {
                      failureReason += '\n\n' + text;
                    }
                  } else if (text) {
                    failureReason = text;
                  }
                  
                  checkData.failureReason = failureReason;
                  checkData.failureTitle = title || null;
                }
                
                // Get annotations (specific error lines) if available
                // Check both annotations_count field and output.annotations_count
                const annotationsCount = check.annotations_count || (check.output && check.output.annotations_count) || 0;
                if (annotationsCount > 0 && check.id) {
                  checkData.hasAnnotations = true;
                  checkData.annotationsUrl = check.annotations_url;
                  checkData.annotationsCount = annotationsCount;
                  
                  // Fetch annotations using gh api
                  const annotationsResult = executeCommand(`gh api repos/${repoInfo.owner}/${repoInfo.repo}/check-runs/${check.id}/annotations 2>/dev/null`, { cwd: repoPath });
                  if (annotationsResult.success && annotationsResult.output && annotationsResult.output.trim()) {
                    try {
                      const annotations = JSON.parse(annotationsResult.output) as Annotation[];
                      if (Array.isArray(annotations) && annotations.length > 0) {
                        // Combine annotation messages
                        const annotationMessages = annotations.map(ann => {
                          const location = ann.path ? `${ann.path}:${ann.start_line || ''}` : '';
                          return location ? `${location}: ${ann.message}` : ann.message;
                        });
                        checkData.failureDetails = annotationMessages;
                        
                        // If no failureReason from output, use first annotation
                        if (!checkData.failureReason && annotationMessages.length > 0) {
                          checkData.failureReason = annotationMessages[0];
                        }
                      }
                    } catch (e) {
                      // Failed to parse annotations - try to use raw output if it's a simple message
                      if (annotationsResult.output && annotationsResult.output.trim().length < 500) {
                        checkData.failureReason = annotationsResult.output.trim();
                      }
                    }
                  }
                } else if (!checkData.failureReason) {
                  // If no annotations but check failed, try to get error from workflow run
                  // This is a fallback - we'll try to get more info from the check run details
                  checkData.failureReason = 'Check failed but no detailed error information available. See check URL for details.';
                }
              }
              
              return checkData;
            }));
          } catch (e) {
            // Not JSON, might be error message
          }
        }
      }
      
      // Fallback: try direct API with token
      if (!checks) {
        const token = process.env.GITHUB_TOKEN || getEnv('GITHUB_TOKEN');
        const repoInfo = getRepoInfo(repoPath);
        if (token && repoInfo) {
          checks = await getChecksViaAPI(repoInfo.owner, repoInfo.repo, sha, token);
        }
      }
    }

    if (!checks) {
      checks = [];
    }

    const summary = calculateSummary(checks);

    return {
      ok: true,
      checks: checks.map(c => ({
        name: c.name,
        status: c.status,
        ...c
      })),
      summary: `Total: ${summary.total}, Success: ${summary.success}, Failure: ${summary.failure}, Pending: ${summary.pending}`
    };
  }
}

