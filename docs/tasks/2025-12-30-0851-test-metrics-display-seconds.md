# Task: Display test metrics in seconds (store in ms)

## 0. Meta

- Date: 2025-12-30
- Agent: 🦆 GPT-5.2 (Cursor Cloud)
- Branch: cursor/test-metrics-display-seconds-8239
- PR: n/a
- Related: n/a

## 1. Intake

The goal is to display **test duration metrics** in seconds (s) instead of milliseconds (ms), while keeping the underlying stored values in milliseconds for precision and compatibility.
This affects the PR metrics comment and the GitHub Pages metrics dashboard (table and charts).
Non-test timing metrics (build/dev) are out of scope unless they are directly part of the test metrics display.

## 2. Status Log

- 2025-12-30 08:51 — Located test duration formatting in `src/ci/render-pr-comment-dashboard.mjs` and `src/ci/generate-metrics-report.mjs`; updated display to seconds while preserving ms in JSON.

## 3. Plan

1. Update PR comment rendering to format test durations/deltas in seconds.
2. Update GitHub Pages dashboard table and charts to show test durations in seconds.
3. Run lint/tests and fix any regressions.

## 4. Implementation Notes

- Test duration values remain stored as `*DurationMs` in metrics JSON; only formatting and chart units were changed.

## 5. CI Attempts

> Fill only if CI fails.

## 6. Final Report

### What changed

- Updated PR comment test duration formatting to always show seconds.
- Updated dashboard table and charts to show test duration in seconds (axis/labels), while preserving stored ms.

### How to verify

- Run the metrics render scripts against any existing `.cache/metrics/current.json`:
  - `node src/ci/render-pr-comment-dashboard.mjs --dir .cache/metrics --out .cache/metrics/pr-comment.md`
  - `node src/ci/generate-metrics-report.mjs --metrics-dir .cache/metrics --out-dir .cache/metrics-pages`
- Confirm unit/e2e durations display with `s` (not `ms`) in the outputs.

### Risks / Follow-ups

- If any external consumer assumes chart Y values are ms, it will now see seconds in the chart only (raw JSON stays ms).

