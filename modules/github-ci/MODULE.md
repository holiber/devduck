---
name: github-ci
version: 0.1.0
description: GitHub CI setup and status checking for GitHub repositories
tags: [ci, github, testing]
dependencies: [core]
defaultSettings:
  gitignore: |
    # environment variables
    .env
    .env.local
    .env.*.local
    
    # Cache directory
    .cache/
    
    # IDE and editor files
    .vscode/
    .idea/
    *.swp
    *.swo
    *~
    
    # OS files
    .DS_Store
    Thumbs.db
    
    # Cursor files
    .cursor/mcp.json
    
    # node modules
    node_modules/
    package-lock.json
    yarn.lock
    
    # Test output files
    tests/installer/output/
    
    # Build outputs
    dist/
    build/
    *.log
    
    # Temporary files
    *.tmp
    *.temp
    
    # Workspace projects directory
    projects/
---
# GitHub CI Module

Module for setting up GitHub Actions CI workflows and checking CI status for GitHub repositories.

## Purpose

This module provides:
- Automated setup of GitHub Actions CI workflows
- CI status checking for pull requests
- Integration with GitHub API and GitHub CLI

## Features

- **CI Setup**: Automatically creates `.github/workflows/ci.yml` for GitHub repositories
  - Auto-detects test command from `package.json`
  - Uses Node.js latest stable version via NVM
  - Configures workflows for push and pull_request events

- **CI Status**: Checks CI status for current PR
  - Uses GitHub CLI (`gh`) or GitHub API
  - Returns all checks with their statuses
  - Provides summary of check results

- **Gitignore Management**: Automatically creates `.gitignore` file in workspace
  - Uses `gitignore` setting from module settings if provided
  - Falls back to `gitignore.default` file in module directory
  - Ensures every workspace with github-ci module gets a proper `.gitignore` file

## Usage

### Setup CI

```bash
/github-setup-ci
```

The AI agent will set up CI workflows directly for all GitHub repositories in the workspace.

### Check CI Status

```bash
node scripts/ci-status.js
```

## Requirements

- GitHub CLI (`gh`) or `GITHUB_TOKEN` environment variable
- Node.js (latest stable via NVM)
- Git repository with GitHub remote

