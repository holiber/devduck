# Task: Ensure main CI stability, metrics baseline, and contributor checks

## Summary

This change enforces contribution rules and hardens `main` CI:

- CI runs on `push` to `main` and on every PR, collecting metrics and producing a GitHub Pages dashboard.
- Tests are retried once on failure to reduce flaky noise.
- Metrics **history/baseline/pages are updated only on successful `main` runs**, so graphs reflect verified results.
- A PR merge check enforces:
  - at least one new task file under `docs/tasks/` matching `YYYY-MM-DD-HHMM-*.md`

## Rationale

- `main` should stay green and its metrics should be trustworthy (no failed runs in the baseline/history).
- Every PR should be traceable via a task file. The release changelog is assembled before publishing a new version.

## Expected CI behavior

- **Merge PR → `main`**: full CI runs automatically and updates the dashboard baseline/history.
- **Test fails once**: CI retries that test step once.
- **Missing task file**: PR check fails with a clear message.

