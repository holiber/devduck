#!/usr/bin/env node

/**
 * Script to check CI status for a GitHub PR using the new GitHubCI class
 */

const path = require('path');
const fs = require('fs');
const GitRepo = require('../../git/scripts/git-repo');
const GitHubCI = require('./github-ci');
const { createYargs, installEpipeHandler } = require('../../../scripts/lib/cli');
const { findWorkspaceRoot } = require('../../../scripts/lib/workspace-root');

/**
 * Main function
 */
async function main() {
  installEpipeHandler();

  const argv = await createYargs(process.argv)
    .scriptName('check-pr-ci')
    .strict()
    .usage('Usage: $0 <prNumber>\n\nCheck GitHub CI merge checks for a PR.')
    .command(
      '$0 <prNumber>',
      'Check CI status for a GitHub PR.',
      (y) =>
        y.positional('prNumber', {
          type: 'number',
          describe: 'Pull request number',
          demandOption: true,
        }),
      () => {},
    )
    .parseAsync();

  const prNumber = Number(argv.prNumber);
  if (!Number.isFinite(prNumber) || prNumber <= 0) {
    console.error('Error: prNumber must be a positive integer');
    process.exit(1);
  }

  // Find repository path
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    console.error('Error: Workspace root not found');
    process.exit(1);
  }

  const repoPath = path.join(workspaceRoot, 'projects', 'devduck');
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    console.error('Error: Not a git repository');
    process.exit(1);
  }

  try {
    // Create repo and CI instances
    const repo = new GitRepo(repoPath);
    const ci = new GitHubCI(repo);

    // Get PR info first
    const { spawnSync } = require('child_process');
    const ghResult = spawnSync('gh', ['pr', 'view', prNumber.toString(), '--json', 'number,headRefName,headRefOid,url,title'], {
      cwd: repoPath,
      encoding: 'utf8'
    });

    if (ghResult.status !== 0) {
      console.error(`Error: Failed to get PR info: ${ghResult.stderr}`);
      process.exit(1);
    }

    const prInfo = JSON.parse(ghResult.stdout);

    // Check merge checks
    const result = await ci.checkMergeChecks({
      number: prInfo.number,
      branch: prInfo.headRefName,
      sha: prInfo.headRefOid
    });

    if (!result.ok) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    // Output results
    const output = {
      pr: {
        number: prInfo.number,
        url: prInfo.url,
        title: prInfo.title,
        branch: prInfo.headRefName,
        sha: prInfo.headRefOid
      },
      checks: result.checks,
      summary: result.summary
    };

    console.log(JSON.stringify(output, null, 2));

    // Exit with error code if there are failures
    if (result.summary.failure > 0) {
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

