# Task: Skip heavy CI on docs-only PRs

## Summary

This change prevents the heavy “Tests & Metrics” GitHub Actions workflow from running on pull requests that modify only documentation.

## Implementation

- The `.github/workflows/ci.yml` workflow now uses `paths-ignore` for `pull_request` events:
  - If the PR changes only `docs/**`, the workflow is not triggered.
  - If the PR changes anything outside `docs/**`, the workflow runs as usual.

## Rationale

- Docs-only PRs should merge faster and avoid consuming CI minutes on irrelevant test runs.
- Test signal remains unchanged for PRs that touch code, scripts, CI, or configuration outside `docs/`.

## Expected CI behavior

- **Docs-only PR**: “Tests & Metrics” does not start.
- **Any non-doc change**: “Tests & Metrics” starts and runs the full suite.

