# Skip CI for docs-only changes

**Date:** 2025-12-30  
**Status:** Completed

## Problem

The `after-merge-ci.yml` workflow runs expensive tests and metrics collection even when only documentation files are changed. This wastes CI resources and time.

## Solution

Added `paths-ignore` configuration to the `after-merge-ci.yml` workflow to skip execution when only files under `docs/**` are modified.

## Changes

- Modified `.github/workflows/after-merge-ci.yml` to include:
  ```yaml
  paths-ignore:
    - "docs/**"
  ```

## Benefits

- Reduces unnecessary CI runs for documentation-only changes
- Saves CI minutes and resources
- Faster feedback for documentation PRs
