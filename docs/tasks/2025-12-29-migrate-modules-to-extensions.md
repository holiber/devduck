# Task: migrate `modules` → `extensions`

This repository was renamed to **Barducks** and the old **module** system naming was replaced with **extensions**.
There is **no legacy support** for `modules/`, `modules:` or `moduleSettings:` in the codebase.

## Goal

Move your existing workspace/repo from:

- directory `modules/` → `extensions/`
- config key `modules:` → `extensions:`
- config key `moduleSettings:` → `extensionSettings:`

## Migration steps

### 1) Rename folders

- In the Barducks repo:
  - rename `modules/` → `extensions/`

- In your workspace (if you had workspace-local modules):
  - rename `<workspaceRoot>/modules/` → `<workspaceRoot>/extensions/`

- In your projects (if you had project-local modules):
  - rename `<workspaceRoot>/projects/<project>/modules/` → `<workspaceRoot>/projects/<project>/extensions/`

### 2) Update `workspace.config.yml`

Replace:

- `modules:` → `extensions:`
- `moduleSettings:` → `extensionSettings:`

Example:

```yaml
version: "0.1.0"
devduck_path: "./projects/barducks"

extensions:
  - core
  - cursor
  - ci

extensionSettings:
  ci:
    provider: github-provider
```

### 3) Update paths in scripts/docs/tests you keep

Search-and-replace typical patterns:

- `modules/<name>/...` → `extensions/<name>/...`
- `projects/<project>/modules/<name>/...` → `projects/<project>/extensions/<name>/...`

### 4) Update CLI usage (if you pin installer flags)

If you run installer with an explicit list, use:

- `--extensions core,cursor,...`

(Do not use `--modules`.)

### 5) External repositories

If you load extensions from `repos:`:

- each external repo must expose `extensions/` at its root (not `modules/`).

## Verification checklist

- `extensions/` exists in the repo and in your workspace where applicable
- `workspace.config.yml` contains `extensions:` and `extensionSettings:` only
- no references to `modules/` remain in your scripts/docs

