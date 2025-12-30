# Metrics chart breakdown

## 0. Meta

- Date: 2025-12-30
- Branch: `cursor/metrics-chart-breakdown-0872`
- Area: Metrics dashboard (GitHub Pages report)

## 1. Intake

The metrics dashboard chart on the metrics page is hard to read because it mixes unrelated metrics in a single plot.
The goal is to split the chart into separate charts for unit tests, e2e tests, and script code lines so each metric family is readable.

## 2. Status Log

- 2025-12-30: Located dashboard generator at `src/ci/generate-metrics-report.mjs` and replaced the single mixed trend chart with three focused charts (unit / e2e / script LOC).

## 3. Plan

1. Ensure the metrics dashboard renders three separate charts driven by `history.json`.
2. Keep the page self-contained (Chart.js via CDN) and robust to missing history entries.
3. Verify lint/tests and fix any CI failures.

## 4. Implementation Notes

- The dashboard now renders three canvases: unit tests, e2e tests (installer + smoke), and script code lines.
- Test totals are available but hidden by default to keep the charts clean.

## 5. CI Attempts

- Attempt 1/5: Follow Guidelines failed because no new task file existed under `docs/tasks/`.
  - Fix: added this task doc.

## 6. Final Report

Pending CI confirmation.

