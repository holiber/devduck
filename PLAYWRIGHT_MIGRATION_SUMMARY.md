# Playwright Installer Tests Migration — Summary

This document captures the final merged approach for migrating installer tests to Playwright Test in a **CI-friendly** and **scalable** way.

## What lives where

- **Playwright installer tests**: `tests/installer/*.pw.spec.ts`
- **Legacy Node.js installer tests (baseline only)**: `tests/legacy/installer/*.test.ts`
  - Kept for baseline comparison and historical reference
  - Explicitly excluded from `npm test` discovery (see `scripts/run-tests.ts`)
- **Perf artifacts (CI/local, not committed)**: `tests/perf/*` (see `.gitignore`)
- **Perf templates (committed)**: `tests/perf/templates/*.md`

## Commands

- **Run remaining Node.js tests**: `npm test`
- **Run installer suite (Playwright)**: `npm run test:installer:pw`
- **Run smoke group**: `npm run test:smoke` (uses `--grep @smoke`)

## CI behavior

GitHub Actions runs:

1. `npm test` (Node.js runner)
2. `npm run test:installer:pw` (Playwright installer suite)
3. Generates a Markdown timing report:
   - `npx tsx scripts/capture-playwright-timings.ts --md > tests/perf/timing-comparison.md`
4. Uploads artifacts:
   - `playwright-report/`
   - `test-results/`
   - `tests/perf/timing-comparison.md`

## Playwright config defaults (installer)

Configured in `playwright.config.ts` for stable CI runs:

- `timeout: 60_000`
- `workers: 1`
- `fullyParallel: false`
- `retries: 1`
- `use.headless: true`
- reporters:
  - `list`
  - `html` (open: never)

## Baseline & smoke policy

- Baseline is captured manually from legacy Node.js tests:
  - `npx tsx scripts/capture-baseline.ts`
  - Outputs:
    - `tests/perf/baseline-snapshot.json`
    - `tests/perf/smoke-group-frozen.json`
    - `tests/perf/smoke-group-frozen.md`
- The **frozen smoke list** is the source of truth; Playwright tests are annotated with `@smoke` in their titles to match it.

