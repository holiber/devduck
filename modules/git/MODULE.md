---
name: git
version: 0.1.0
description: Git integration - generates .gitignore for projects
tags: [git, vcs, essential]
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
# Git Module

Module for Git integration. Generates `.gitignore` file for projects during installation.

This module is essential and should be included in all workspace installations to ensure proper Git ignore patterns.

## Purpose

This module provides:
- Automatic `.gitignore` file generation
- Common ignore patterns for development environments
- Configurable ignore patterns via workspace settings

## Configuration

You can override the default `.gitignore` content in `workspace.config.json`:

```json
{
  "moduleSettings": {
    "git": {
      "gitignore": "custom content here"
    }
  }
}
```

