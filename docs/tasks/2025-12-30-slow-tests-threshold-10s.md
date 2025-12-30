# Task: Change slow tests metric threshold to 10s

## 0. Meta

- Date: 2025-12-30
- Agent: 🦆 GPT-5.2
- Branch: cursor/slow-test-threshold-optimization-cd64
- PR: n/a (local workspace change)
- Related: n/a

## 1. Task

### What to do

- Change the “🐢 Slow tests (>20s)” metric to “🐢 Slow tests (>10s)”.
- Ensure the threshold used in metrics collection is 10 seconds.
- Update all metric renderers (PR comment + HTML report) to match.
- Avoid misleading deltas when baseline/current use different thresholds.

### Definition of Done (acceptance criteria)

- The slow-tests threshold is 10,000ms in metrics collection output (`current.json`).
- The PR comment dashboard and HTML dashboard show “🐢 Slow tests (>10s)” (derived from `thresholdMs`).
- Metrics diff uses a consistent delta key for the updated threshold and does not compute a delta when thresholds differ.

### Out of scope

- Changing what tests run or how timings are produced (this task only changes the metric threshold/labeling).

## 2. Status Log

- 2025-12-30 — Located slow-tests metric threshold and all hardcoded “>20s” renderers; updated collector, diffing, and renderers to use “>10s”.

## 3. Plan

1. Update the slow-tests threshold in the collector from 20s to 10s.
2. Update metric renderers (PR comment + HTML dashboard) to show the threshold dynamically from `thresholdMs`.
3. Update the diff delta key and guard delta computation when baseline/current thresholds differ.
4. Run repository test suite (`npm test`).

## 4. Implementation Notes

- The slow-tests UI labels now derive from `current.quality.slowTests.thresholdMs`, avoiding duplicated hardcoded text.
- The slow-tests delta is only computed when baseline and current use the same slow-tests threshold, preventing noisy PR deltas during the transition.
- **The slow-tests metric includes BOTH Unit tests AND E2E tests** (pw_installer, pw_smoke). The total count aggregates slow tests across all test suites, with a breakdown available in `bySuite`.

## 5. CI Attempts

> Not used (local run only).

## 6. Final Report

### What changed

- Changed slow-tests threshold from 20s to 10s in metrics collection.
- Updated PR comment + HTML dashboard output to show “🐢 Slow tests (>10s)” based on `thresholdMs`.
- Renamed the diff delta key to `slow_tests_over_10s` and skipped delta calculation when thresholds differ.

### How to verify

- Run `npm test`.
- (Optional) Run the CI scripts locally by generating `.cache/metrics/current.json` and verifying the rendered dashboards show “>10s”.

### Risks / Follow-ups

- None expected; the only behavioral change is the threshold (more tests may now qualify as “slow”).

