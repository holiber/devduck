#!/usr/bin/env node

const path = require('path');
const https = require('https');
const fs = require('fs');

// Resolve core module path - find workspace root first
function findWorkspaceRootForModules() {
  let current = process.cwd();
  const maxDepth = 10;
  let depth = 0;
  
  while (depth < maxDepth) {
    const configPath = path.join(current, 'workspace.config.json');
    if (fs.existsSync(configPath)) {
      return current;
    }
    
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
    depth++;
  }
  
  // Fallback: try from __dirname
  current = path.resolve(__dirname);
  depth = 0;
  while (depth < maxDepth) {
    const configPath = path.join(current, 'workspace.config.json');
    if (fs.existsSync(configPath)) {
      return current;
    }
    
    const devduckPath = path.join(current, 'projects', 'devduck');
    if (fs.existsSync(devduckPath)) {
      return current;
    }
    
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
    depth++;
  }
  
  return null;
}

const workspaceRoot = findWorkspaceRootForModules();
const devduckRoot = workspaceRoot ? path.join(workspaceRoot, 'projects', 'devduck') : path.resolve(__dirname, '../../../../devduck');
// Try scripts/ first (legacy), then modules/core/scripts/
let coreUtilsPath = path.join(devduckRoot, 'scripts/utils.js');
let coreEnvPath = path.join(devduckRoot, 'scripts/lib/env.js');
if (!fs.existsSync(coreUtilsPath)) {
  coreUtilsPath = path.join(devduckRoot, 'modules/core/scripts/utils.js');
  coreEnvPath = path.join(devduckRoot, 'modules/core/scripts/lib/env.js');
}

const { executeCommand } = require(coreUtilsPath);
const { getEnv } = require(coreEnvPath);

/**
 * Find workspace root by looking for workspace.config.json
 */
function findWorkspaceRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  const maxDepth = 10;
  let depth = 0;
  
  while (depth < maxDepth) {
    const configPath = path.join(current, 'workspace.config.json');
    if (fs.existsSync(configPath)) {
      return current;
    }
    
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
    depth++;
  }
  
  return null;
}

/**
 * Get current branch name
 */
function getCurrentBranch(repoPath) {
  const result = executeCommand('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
  if (!result.success) {
    return null;
  }
  return result.output.trim();
}

/**
 * Get PR info for current branch using gh CLI
 */
function getPRInfoViaCLI(repoPath, branch) {
  const ghResult = executeCommand(`gh pr view ${branch} --json number,url,title,headRefName,headSha 2>/dev/null`, { cwd: repoPath });
  if (!ghResult.success) {
    return null;
  }
  
  try {
    const pr = JSON.parse(ghResult.output);
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
function getPRInfoViaAPI(repoPath, branch, token) {
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
    const path = `/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`;
    
    const req = https.request(
      {
        method: 'GET',
        hostname: 'api.github.com',
        path: path,
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
              const prs = JSON.parse(data);
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
function getChecksViaCLI(repoPath, prNumber) {
  const ghResult = executeCommand(`gh pr checks ${prNumber} --json name,status,conclusion,url 2>/dev/null`, { cwd: repoPath });
  if (!ghResult.success) {
    return null;
  }
  
  try {
    const checks = JSON.parse(ghResult.output);
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
function getChecksViaAPI(owner, repo, sha, token) {
  return new Promise((resolve) => {
    const path = `/repos/${owner}/${repo}/commits/${sha}/check-runs`;
    
    const req = https.request(
      {
        method: 'GET',
        hostname: 'api.github.com',
        path: path,
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
              const response = JSON.parse(data);
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
function getRepoInfo(repoPath) {
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
function calculateSummary(checks) {
  const summary = {
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
async function main() {
  // Determine repository path
  // First, try to find if we're in a project directory
  let repoPath = process.cwd();
  const workspaceRoot = findWorkspaceRoot();
  
  // Check if current directory is a git repo
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    // Try to find GitHub repos in workspace
    if (workspaceRoot) {
      const configPath = path.join(workspaceRoot, 'workspace.config.json');
      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error.message || 'Unknown error'
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  main,
  getPRInfoViaCLI,
  getPRInfoViaAPI,
  getChecksViaCLI,
  getChecksViaAPI,
  calculateSummary
};

