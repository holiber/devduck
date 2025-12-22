#!/usr/bin/env node

const { executeCommand } = require('./utils');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { getEnv } = require('./lib/env');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const getValue = (flag) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    return args[idx + 1] || null;
  };
  return {
    autoConfirm: args.includes('-y') || args.includes('--yes'),
    updateDescription: args.includes('--update-description'),
    checkArToken: args.includes('--check-ar-token'),
    fromPlan: getValue('--from-plan'),
    createFromPlan: args.includes('--create-from-plan'),
    archivePlan: args.includes('--archive-plan'),
  };
}

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function readTextFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function parsePlanTitleAndDescription(planText) {
  const lines = planText.split('\n');
  const titleLine = lines[0] || '';
  const title = titleLine.replace(/^#\s+/, '').trim();

  const marker = '## PR Description';
  const idx = lines.findIndex((l) => l.trim() === marker);
  if (idx === -1) {
    return { title, description: '' };
  }

  const descLines = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('## ')) break;
    if (l.trim() === '---') break;
    descLines.push(l);
  }

  while (descLines.length && !descLines[0].trim()) descLines.shift();
  while (descLines.length && !descLines[descLines.length - 1].trim()) descLines.pop();

  return { title, description: descLines.join('\n') };
}

function validatePlanHasTitleAndDescription(planPath) {
  try {
    const txt = readTextFile(planPath);
    const parsed = parsePlanTitleAndDescription(txt);
    const errors = [];
    if (!parsed.title) errors.push('Plan title is empty.');
    if (!parsed.description) errors.push('Plan PR Description block is empty or missing.');
    return { ok: errors.length === 0, errors, ...parsed };
  } catch (e) {
    return { ok: false, errors: [e.message], title: '', description: '' };
  }
}

function makeTimestampForFilename(d = new Date()) {
  return d.toISOString().replace(/:/g, '-');
}

function archivePlanFile(planPath) {
  const root = getProjectRoot();
  const trashDir = path.join(root, '.cache', 'trash');
  fs.mkdirSync(trashDir, { recursive: true });
  const base = path.basename(planPath).replace(/\.md$/i, '');
  const ts = makeTimestampForFilename();
  const dst = path.join(trashDir, `${base}.${ts}.md`);
  fs.renameSync(planPath, dst);
  return dst;
}

function runArcPrCreateFromPlan({ title, description }) {
  const root = getProjectRoot();
  const tmpDir = path.join(root, '.cache', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const msgPath = path.join(tmpDir, `pr-message.${makeTimestampForFilename()}.txt`);
  const msg = `${title}\n\n${description}\n`;
  fs.writeFileSync(msgPath, msg, 'utf8');

  const res = spawnSync('arc', ['pr', 'create', '--no-commits', '--no-edit', '-F', msgPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    ok: res.status === 0,
    status: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim(),
    messageFile: msgPath,
  };
}

function getArToken() {
  return getEnv('AR_TOKEN', { envPath: path.join(getProjectRoot(), '.env') });
}

function updateArcanumPrDescription({ prId, description, token }) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ description });

    const req = https.request(
      {
        method: 'PUT',
        hostname: 'arcanum.yandex.net',
        path: `/api/v1/review-requests/${prId}/description`,
        headers: {
          Authorization: `OAuth ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode === 200 || res.statusCode === 204,
            statusCode: res.statusCode,
            body: data,
          });
        });
      }
    );

    req.on('error', (err) => {
      resolve({ ok: false, statusCode: null, error: err.message });
    });

    req.write(body);
    req.end();
  });
}

function checkArcanumToken({ prId, token }) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: 'arcanum.yandex.net',
        path: `/api/v1/pull-requests/${prId}?fields=description`,
        headers: {
          Authorization: `OAuth ${token}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode === 200,
            statusCode: res.statusCode,
            body: data,
          });
        });
      }
    );

    req.on('error', (err) => {
      resolve({ ok: false, statusCode: null, error: err.message });
    });

    req.end();
  });
}

/**
 * Get current branch name
 */
function getCurrentBranch() {
  const result = executeCommand('arc info');
  if (!result.success) {
    return null;
  }
  
  const branchMatch = result.output.match(/branch:\s*(.+)/i);
  if (branchMatch) {
    return branchMatch[1].trim();
  }
  
  return null;
}

/**
 * Get list of changed files (same logic as commit.js)
 */
function getChangedFiles() {
  const files = [];
  
  // Get staged changes first
  const diffCachedResult = executeCommand('arc diff --cached --name-status');
  if (diffCachedResult.success && diffCachedResult.output) {
    const diffLines = diffCachedResult.output.split('\n').filter(l => l.trim());
    diffLines.forEach(line => {
      const match = line.match(/^([AMDR])\s+(.+)$/);
      if (match) {
        files.push({
          status: match[1],
          file: match[2].trim()
        });
      }
    });
  }
  
  // Get unstaged and untracked files
  const statusResult = executeCommand('arc status');
  if (!statusResult.success) {
    return files;
  }
  
  const lines = statusResult.output.split('\n');
  let inUnstagedSection = false;
  let inUntrackedSection = false;
  let inStagedSection = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
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
    
    if (!trimmed || 
        trimmed.startsWith('(') || 
        trimmed.startsWith('use "arc') ||
        trimmed.startsWith('On branch') ||
        trimmed.startsWith('Your branch') ||
        trimmed.includes('nothing to commit') ||
        trimmed.includes('no changes added')) {
      continue;
    }
    
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
        const existing = files.find(f => f.file === fileName);
        if (!existing) {
          files.push({ status, file: fileName });
        }
      }
      continue;
    }
    
    if (inUntrackedSection) {
      if ((trimmed.includes('/') || trimmed.includes('.')) && !trimmed.includes('arc ')) {
        const fileName = trimmed;
        const existing = files.find(f => f.file === fileName);
        if (!existing) {
          files.push({
            status: '?',
            file: fileName
          });
        }
      }
    }
  }
  
  return files;
}

/**
 * Get commits not yet pushed
 */
function getUnpushedCommits() {
  const result = executeCommand('arc log --oneline @{u}..HEAD 2>/dev/null || arc log --oneline -10');
  if (!result.success) {
    return [];
  }
  
  const commits = [];
  const lines = result.output.split('\n').filter(l => l.trim());
  
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
 * Check if PR exists for current branch
 */
function getPRStatus() {
  const result = executeCommand('arc pr status --json');
  
  if (!result.success) {
    // Check if error indicates no PR
    if (result.error && (result.error.includes('no pull request') || result.error.includes('not found'))) {
      return { exists: false, pr: null };
    }
    // Try parsing output even on error (sometimes arc returns error code but has output)
    if (result.output) {
      try {
        const pr = JSON.parse(result.output);
        return { exists: true, pr };
      } catch (e) {
        // Not valid JSON
      }
    }
    return { exists: false, pr: null, error: result.error };
  }
  
  try {
    const pr = JSON.parse(result.output);
    if (pr && pr.id) {
      return { exists: true, pr };
    }
    return { exists: false, pr: null };
  } catch (e) {
    return { exists: false, pr: null, error: 'Failed to parse PR status' };
  }
}

/**
 * Get all commits in the branch (compared to trunk)
 */
function getBranchCommits() {
  // Get commits that are in current branch but not in trunk
  const result = executeCommand('arc log --oneline trunk..HEAD');
  if (!result.success) {
    // Fallback: get recent commits
    const fallback = executeCommand('arc log --oneline -20');
    if (!fallback.success) {
      return [];
    }
    return parseCommitLog(fallback.output);
  }
  
  return parseCommitLog(result.output);
}

/**
 * Parse commit log output
 */
function parseCommitLog(output) {
  const commits = [];
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
 * Generate PR title from branch name or commits
 */
function generatePRTitle(branchName, commits) {
  // Try to extract ticket from branch name (e.g., users/alex/TICKET-123-feature)
  const ticketMatch = branchName.match(/([A-Z]+-\d+)/i);
  if (ticketMatch) {
    return `[${ticketMatch[1].toUpperCase()}] ${commits[0]?.message || 'Update'}`;
  }
  
  // Use first commit message or branch name
  if (commits.length > 0) {
    return commits[0].message;
  }
  
  // Fallback to branch name
  const branchParts = branchName.split('/');
  return `PR from branch ${branchParts[branchParts.length - 1]}`;
}

/**
 * Generate PR description from commits
 */
function generatePRDescription(commits, changedFiles) {
  const lines = [];
  
  // Summary section
  lines.push('## Summary');
  lines.push('');
  
  if (commits.length === 1) {
    lines.push(commits[0].message);
  } else if (commits.length > 1) {
    lines.push('This PR includes the following changes:');
    lines.push('');
    for (const commit of commits.slice(0, 10)) {
      lines.push(`- ${commit.message}`);
    }
    if (commits.length > 10) {
      lines.push(`- ... and ${commits.length - 10} more commits`);
    }
  } else {
    lines.push('Code changes');
  }
  
  lines.push('');

  // High-signal areas (directory-aware), to avoid missing changes like recipes/ docs.
  if (changedFiles && changedFiles.length > 0) {
    const dirCounts = summarizeByTopLevelDir(changedFiles);
    if (dirCounts.length > 0) {
      lines.push('## Affected Areas');
      lines.push('');
      for (const { dir, count } of dirCounts.slice(0, 8)) {
        const label = String(dir).endsWith('/') ? String(dir) : String(dir);
        lines.push(`- \`${label}\` (${count} file${count === 1 ? '' : 's'})`);
      }
      if (dirCounts.length > 8) {
        lines.push(`- ... and ${dirCounts.length - 8} more`);
      }
      lines.push('');
    }
  }
  
  // Changed files section
  if (changedFiles && changedFiles.length > 0) {
    lines.push('## Changed Files');
    lines.push('');
    
    const added = changedFiles.filter(f => f.status === 'A' || f.status === '?');
    const modified = changedFiles.filter(f => f.status === 'M');
    const deleted = changedFiles.filter(f => f.status === 'D');
    
    if (added.length > 0) {
      lines.push(`**Added (${added.length}):**`);
      for (const f of added.slice(0, 5)) {
        lines.push(`- \`${f.file}\``);
      }
      if (added.length > 5) {
        lines.push(`- ... and ${added.length - 5} more`);
      }
      lines.push('');
    }
    
    if (modified.length > 0) {
      lines.push(`**Modified (${modified.length}):**`);
      for (const f of modified.slice(0, 5)) {
        lines.push(`- \`${f.file}\``);
      }
      if (modified.length > 5) {
        lines.push(`- ... and ${modified.length - 5} more`);
      }
      lines.push('');
    }
    
    if (deleted.length > 0) {
      lines.push(`**Deleted (${deleted.length}):**`);
      for (const f of deleted.slice(0, 5)) {
        lines.push(`- \`${f.file}\``);
      }
      if (deleted.length > 5) {
        lines.push(`- ... and ${deleted.length - 5} more`);
      }
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

/**
 * Get diff stats for the branch
 */
function getDiffStats() {
  const result = executeCommand('arc diff trunk --stat');
  if (!result.success) {
    return null;
  }
  return result.output;
}

/**
 * Get changed files for the PR range (only files changed in branch commits).
 *
 * Instead of comparing entire branch state against trunk (which includes
 * unrelated changes if branch is behind), we only show files changed in
 * the commits that are in this branch.
 */
function getBranchChangedFilesAgainstTrunk() {
  // Get all commits in the branch (not in trunk)
  const branchCommits = getBranchCommits();
  
  if (branchCommits.length === 0) {
    return { ok: true, files: [], error: null };
  }

  // Collect all files changed across all branch commits
  const filesMap = new Map(); // file -> status (keep latest status if file appears in multiple commits)
  
  for (const commit of branchCommits) {
    // Get files changed in this specific commit
    // Using arc show with --name-status to get file list
    const result = executeCommand(`arc show ${commit.hash} --name-status`);
    if (!result.success || !result.output) {
      continue; // Skip this commit if we can't get its files
    }

    const lines = result.output.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      // Example: "M       path/to/file" or "A       path/to/file"
      // Only match lines that start with status letter (A/M/D/R) followed by whitespace
      const match = line.match(/^([AMDR])\s+(.+)$/);
      if (match) {
        const status = match[1];
        const file = match[2].trim();
        // Keep the latest status if file appears in multiple commits
        // Priority: A > M > D > R (added > modified > deleted > renamed)
        const currentStatus = filesMap.get(file);
        if (!currentStatus || (status === 'A' && currentStatus !== 'A') || 
            (status === 'M' && currentStatus === 'D')) {
          filesMap.set(file, status);
        }
      }
    }
  }

  // Convert map to array
  const files = Array.from(filesMap.entries()).map(([file, status]) => ({
    status,
    file
  }));

  return { ok: true, files, error: null };
}

function summarizeByTopLevelDir(changedFiles) {
  const counts = new Map();
  for (const f of changedFiles) {
    const parts = String(f.file || '').split('/').filter(Boolean);

    // Heuristic for Arcadia working copies where files are often under:
    // junk/<user>/<project>/<area>/...
    // Use <area> as the "affected area" to make summaries meaningful.
    let area = '(root)';
    if (parts.length === 0) {
      area = '(root)';
    } else if (parts[0] === 'junk' && parts.length >= 4) {
      area = parts[3]; // <area>
    } else {
      area = parts.length > 1 ? parts[0] : '(root)';
    }

    counts.set(area, (counts.get(area) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([dir, count]) => ({ dir, count }));
}

/**
 * Main function - outputs JSON for AI agent
 */
function main() {
  const options = parseArgs();

  // Standalone token check mode (used by ai.config.json check).
  if (options.checkArToken) {
    const token = getArToken();
    if (!token) {
      console.error('AR_TOKEN is missing (set it in .env or export it in the environment).');
      process.exit(1);
    }
    // Use a known PR id for permission check.
    const prId = 11143455;
    checkArcanumToken({ prId, token }).then((res) => {
      if (res.ok) {
        console.log(`AR_TOKEN OK (GET /api/v1/pull-requests/${prId}?fields=description -> ${res.statusCode})`);
        process.exit(0);
      }
      console.error(`AR_TOKEN FAILED (status: ${res.statusCode ?? 'n/a'})`);
      if (res.body) {
        console.error(res.body.slice(0, 300));
      }
      process.exit(1);
    }).catch((e) => {
      console.error(`AR_TOKEN check error: ${e.message}`);
      process.exit(1);
    });
    return;
  }

  const output = {
    branch: null,
    canCreatePR: false,
    autoCreatePR: false,
    autoPush: false,
    hasUncommittedChanges: false,
    uncommittedFiles: [],
    hasUnpushedCommits: false,
    unpushedCommits: [],
    branchCommits: [],
    prExists: false,
    existingPR: null,
    suggestedTitle: null,
    suggestedDescription: null,
    updatedDescription: null,
    warnings: [],
    info: [],
    actions: [],
    prUrl: null
  };
  
  // Get current branch
  const currentBranch = getCurrentBranch();
  if (!currentBranch) {
    output.error = 'Failed to get current branch info';
    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }
  output.branch = currentBranch;
  
  // Check if on trunk
  if (currentBranch === 'trunk' || currentBranch.toLowerCase() === 'trunk') {
    output.error = 'Cannot create PR from trunk branch. Please create a feature branch first.';
    output.warnings.push({
      type: 'trunk_branch',
      message: 'You are on trunk branch. Create a feature branch with: arc checkout -b <branch-name>',
      severity: 'high'
    });
    console.log(JSON.stringify(output, null, 2));
    process.exit(1);
  }
  
  output.canCreatePR = true;
  
  // Check for uncommitted changes
  const changedFiles = getChangedFiles();
  if (changedFiles.length > 0) {
    output.hasUncommittedChanges = true;
    output.uncommittedFiles = changedFiles.map(f => ({
      status: f.status,
      file: f.file,
      statusName: f.status === 'A' ? 'added' : f.status === 'M' ? 'modified' : f.status === 'D' ? 'deleted' : f.status === 'R' ? 'renamed' : f.status === '?' ? 'untracked' : 'unknown'
    }));
    output.actions.push({
      type: 'commit_required',
      message: `Commit ${changedFiles.length} changed file(s) before creating PR`,
      command: 'Use /commit command first'
    });
  }
  
  // Get branch commits (all commits in branch compared to trunk)
  const branchCommits = getBranchCommits();
  output.branchCommits = branchCommits;

  // Compute the PR diff (files changed vs trunk).
  const diffRes = getBranchChangedFilesAgainstTrunk();
  output.diffAvailable = diffRes.ok;
  if (diffRes.ok) {
    output.prChangedFiles = diffRes.files;
    output.prChangedDirs = summarizeByTopLevelDir(diffRes.files);
  } else {
    output.prChangedFiles = [];
    output.prChangedDirs = [];
  }
  
  // Check for unpushed commits
  const unpushedCommits = getUnpushedCommits();
  if (unpushedCommits.length > 0) {
    output.hasUnpushedCommits = true;
    output.unpushedCommits = unpushedCommits;
    output.actions.push({
      type: 'push_required',
      message: `Push ${unpushedCommits.length} commit(s) to remote`,
      command: 'arc push'
    });
  }
  
  // Check PR status
  const prStatus = getPRStatus();
  output.prExists = prStatus.exists;
  
  if (prStatus.exists && prStatus.pr) {
    output.existingPR = {
      id: prStatus.pr.id,
      url: prStatus.pr.url,
      summary: prStatus.pr.summary,
      status: prStatus.pr.status,
      from_branch: prStatus.pr.from_branch,
      to_branch: prStatus.pr.to_branch
    };
    output.info.push({
      type: 'pr_exists',
      message: `PR #${prStatus.pr.id} already exists for this branch`,
      url: prStatus.pr.url
    });
    output.prUrl = prStatus.pr.url;

    // We can still generate a recommended description for updating.
    output.suggestedDescription = generatePRDescription(branchCommits, output.prChangedFiles || []);
  } else {
    // Generate suggested title and description for new PR
    output.suggestedTitle = generatePRTitle(currentBranch, branchCommits);
    output.suggestedDescription = generatePRDescription(branchCommits, output.prChangedFiles || []);
    
    output.actions.push({
      type: 'create_pr',
      message: 'Create new Pull Request',
      command: `arc pr create -m "${output.suggestedTitle}"`
    });
  }
  
  // Add warnings
  if (branchCommits.length === 0 && !output.hasUncommittedChanges) {
    output.warnings.push({
      type: 'no_changes',
      message: 'No commits in this branch compared to trunk. Nothing to create PR for.',
      severity: 'high'
    });
  }
  
  if (branchCommits.length > 20) {
    output.warnings.push({
      type: 'many_commits',
      message: `Large PR with ${branchCommits.length} commits. Consider splitting into smaller PRs.`,
      severity: 'medium'
    });
  }
  
  // Auto actions (same logic as commit.js -y/--yes):
  // allow auto-run only if -y is passed and there are no warnings and no uncommitted changes.
  const hasWarnings = output.warnings.length > 0;
  const canAuto = options.autoConfirm && output.canCreatePR && !hasWarnings && !output.hasUncommittedChanges;
  output.autoPush = canAuto && output.hasUnpushedCommits;
  output.autoCreatePR = canAuto && !output.prExists && branchCommits.length > 0;

  // Get diff stats if no uncommitted changes
  if (!output.hasUncommittedChanges) {
    const diffStats = getDiffStats();
    if (diffStats) {
      output.diffStats = diffStats;
    }
  }

  // Optional: update Arcanum PR description (only when explicitly requested).
  if (options.updateDescription) {
    if (!output.prExists || !output.existingPR?.id) {
      output.warnings.push({
        type: 'no_pr',
        message: 'Cannot update description: no PR exists for this branch.',
        severity: 'high',
      });
    } else if (!options.fromPlan) {
      output.warnings.push({
        type: 'missing_plan_path',
        message: 'Cannot update description: provide --from-plan <path-to-plan.md>.',
        severity: 'high',
      });
    } else if (!getArToken()) {
      output.warnings.push({
        type: 'missing_ar_token',
        message: 'Cannot update description: AR_TOKEN is not set (put it into .env or export it).',
        severity: 'high',
      });
    } else {
      const validated = validatePlanHasTitleAndDescription(options.fromPlan);
      if (!validated.ok) {
        output.warnings.push({
          type: 'invalid_plan',
          message: `Cannot update description: invalid plan (${validated.errors.join(' ')})`,
          severity: 'high',
        });
      } else {
        output.plan = { path: options.fromPlan, title: validated.title };
        // Use plan as the single source of truth for Arcanum update.
        output.suggestedDescription = validated.description;
      }
    }
  }

  // Optional: create PR from plan (only when explicitly requested).
  if (options.createFromPlan) {
    if (output.prExists) {
      output.warnings.push({
        type: 'pr_exists',
        message: 'Cannot create PR: PR already exists for this branch.',
        severity: 'high',
      });
    } else if (!options.fromPlan) {
      output.warnings.push({
        type: 'missing_plan_path',
        message: 'Cannot create PR: provide --from-plan <path-to-plan.md>.',
        severity: 'high',
      });
    } else {
      const validated = validatePlanHasTitleAndDescription(options.fromPlan);
      if (!validated.ok) {
        output.warnings.push({
          type: 'invalid_plan',
          message: `Cannot create PR: invalid plan (${validated.errors.join(' ')})`,
          severity: 'high',
        });
      } else {
        output.plan = { path: options.fromPlan, title: validated.title };
      }
    }
  }

  const hasBlockingWarnings = output.warnings.some((w) => w.severity === 'high');

  // Diff must be available for plan-based PR descriptions.
  if (!output.diffAvailable && branchCommits.length > 0) {
    output.warnings.push({
      type: 'diff_unavailable',
      message: `Cannot reliably generate PR plan/description: failed to get diff vs trunk (${diffRes.error || 'unknown error'}). Try remounting Arcadia working copy and rerun.`,
      severity: 'high',
    });
  }

  // Run the update only if there are no new warnings added by the update gate.
  if (options.updateDescription && !hasBlockingWarnings && output.prExists && output.existingPR?.id && getArToken() && output.suggestedDescription) {
    // Run synchronously-ish: we need to await, but main() is sync; use executeCommand-like flow by blocking on promise.
    // eslint-disable-next-line no-inner-declarations
    async function runUpdate() {
      const token = getArToken();
      const res = await updateArcanumPrDescription({
        prId: output.existingPR.id,
        description: output.suggestedDescription,
        token,
      });
      output.updatedDescription = {
        ok: res.ok,
        statusCode: res.statusCode,
      };
      if (!res.ok) {
        output.warnings.push({
          type: 'update_description_failed',
          message: `Failed to update PR description via Arcanum API (status: ${res.statusCode ?? 'n/a'}).`,
          severity: 'high',
        });
      } else {
        output.info.push({
          type: 'description_updated',
          message: `Updated PR description via Arcanum API for PR #${output.existingPR.id}.`,
        });
        if (output.existingPR?.url) {
          output.info.push({
            type: 'pr_url',
            message: 'PR URL',
            url: output.existingPR.url,
          });
        }
        output.prUrl = output.existingPR?.url || output.prUrl;
      }

      if (options.archivePlan && options.fromPlan) {
        try {
          const archivedTo = archivePlanFile(options.fromPlan);
          output.info.push({
            type: 'plan_archived',
            message: `Archived plan file to ${archivedTo}`,
          });
          output.archivedPlanPath = archivedTo;
        } catch (e) {
          output.warnings.push({
            type: 'plan_archive_failed',
            message: `Failed to archive plan: ${e.message}`,
            severity: 'medium',
          });
        }
      }

      console.log(JSON.stringify(output, null, 2));
    }
    runUpdate().catch((e) => {
      output.updatedDescription = { ok: false, statusCode: null, error: e.message };
      output.warnings.push({
        type: 'update_description_error',
        message: `Failed to update PR description: ${e.message}`,
        severity: 'high',
      });
      console.log(JSON.stringify(output, null, 2));
    });
    return;
  }

  // Create PR from plan if requested and safe.
  if (options.createFromPlan && !hasBlockingWarnings) {
    const validated = validatePlanHasTitleAndDescription(options.fromPlan);
    const createRes = runArcPrCreateFromPlan({ title: validated.title, description: validated.description });
    output.createdPR = {
      ok: createRes.ok,
      status: createRes.status,
      messageFile: createRes.messageFile,
      stdout: createRes.stdout,
      stderr: createRes.stderr,
    };

    if (!createRes.ok) {
      output.warnings.push({
        type: 'create_pr_failed',
        message: `Failed to create PR from plan (exit: ${createRes.status}).`,
        severity: 'high',
      });
    } else {
      output.info.push({
        type: 'pr_created',
        message: 'Created PR from plan via arc pr create.',
      });
    }

    // Best-effort: fetch PR URL after creation.
    const statusAfter = getPRStatus();
    if (statusAfter.exists && statusAfter.pr && statusAfter.pr.url) {
      output.prUrl = statusAfter.pr.url;
      output.info.push({
        type: 'pr_url',
        message: 'PR URL',
        url: statusAfter.pr.url,
      });
    }

    if (options.archivePlan && options.fromPlan && createRes.ok) {
      try {
        const archivedTo = archivePlanFile(options.fromPlan);
        output.info.push({
          type: 'plan_archived',
          message: `Archived plan file to ${archivedTo}`,
        });
        output.archivedPlanPath = archivedTo;
      } catch (e) {
        output.warnings.push({
          type: 'plan_archive_failed',
          message: `Failed to archive plan: ${e.message}`,
          severity: 'medium',
        });
      }
    }

    console.log(JSON.stringify(output, null, 2));
    process.exit(createRes.ok ? 0 : 2);
  }

  // If PR exists, offer an action to update description (manual step).
  if (output.prExists && output.existingPR?.id) {
    output.actions.push({
      type: 'update_pr_description_from_plan',
      message: 'Update PR description using PR Description block from a plan file',
      command: 'set -a; source .env; set +a; node scripts/pr.js --update-description --from-plan .cache/tasks/pr/<name>.plan.md --archive-plan',
    });
  }

  if (!output.prExists) {
    output.actions.push({
      type: 'create_pr_from_plan',
      message: 'Create PR using title/description from a plan file',
      command: 'node scripts/pr.js --create-from-plan --from-plan .cache/tasks/pr/<name>.plan.md --archive-plan',
    });
  }

  console.log(JSON.stringify(output, null, 2));
  return;
}

// Run main function
main();

