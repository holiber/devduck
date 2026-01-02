# Git Module

Module for Git integration. Generates `.gitignore` file for projects during installation.

This module is essential and should be included in all workspace installations to ensure proper Git ignore patterns.

## Purpose

This module provides:
- Automatic `.gitignore` file generation
- Common ignore patterns for development environments
- Configurable ignore patterns via workspace settings

## Configuration

You can override the default `.gitignore` content in `workspace.config.yml`:

```json
{
  "moduleSettings": {
    "git": {
      "gitignore": "custom content here"
    }
  }
}
```

