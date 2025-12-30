# CI split: PR checks + AFTER MERGE metrics (with charts)

## Summary

- Split CI into two workflows:
  - `PR - Tests & Metrics` (`.github/workflows/ci.yml`): runs on pull requests, runs tests, collects metrics and compares them to the `main` baseline.
  - `AFTER MERGE - Tests & Metrics` (`.github/workflows/after-merge-ci.yml`): runs on `push` to `main` (after PR merge), runs tests, collects metrics, updates baseline + history, and deploys the dashboard for charts.
- Added a GitHub Actions status badge to `README.md` for the AFTER MERGE workflow on the `main` branch.

## Notes

- The dashboard HTML includes a trend chart built from `history.json` (updated only on successful `main` runs).

