# Fix Follow Guidelines CI Shallow Fetch Issue

**Date:** 2025-12-30  
**Type:** Bug Fix  
**Status:** ✅ Done

## Context

The "Follow Guidelines" CI workflow was failing with "no merge base" error when trying to verify that PRs include a task file. This happened because the workflow was using `git fetch origin main --depth=1`, which didn't fetch enough history to find the common ancestor between the PR branch and main.

## Problem

When a PR branch is based on an older commit that's not in the shallow fetch (depth=1) of main, git cannot find a merge base, causing the command `git diff origin/main...HEAD` to fail with:
```
fatal: origin/main...HEAD: no merge base
```

This made it impossible for the CI to verify if new files were added to the PR.

## Solution

Removed the `--depth=1` flag from the main branch fetch step in `.github/workflows/follow-guidelines.yml`:

```yaml
- name: Fetch main
  run: git fetch origin main
```

The checkout step already uses `fetch-depth: 0` to get full history of the PR branch, so now both branches have sufficient history to find their merge base.

## Testing

- Verified locally that `git diff origin/main...HEAD` works correctly after fetching full main history
- The fix allows the CI to properly detect added files in the PR

## Follow-up

None required. The CI should now work correctly for all PRs regardless of how old their base commit is.
