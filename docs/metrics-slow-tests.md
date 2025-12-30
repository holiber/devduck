# Slow Tests Metric

## Overview

The "🐢 Slow tests (>10s)" metric tracks tests that exceed a 10-second execution threshold across **both Unit tests and E2E tests**.

## Metric Calculation

The metric is calculated in `src/ci/collect-metrics.mjs` and includes:

1. **Unit tests** - Parsed from Node.js test output in `.cache/logs/npm-test.log`
2. **E2E installer tests** - Parsed from Playwright JSON report in `.cache/metrics/pw-installer-report.json`
3. **E2E smoke tests** - Parsed from Playwright JSON report in `.cache/metrics/pw-smoke-report.json`

The total count aggregates slow tests across all test suites.

## Data Structure

The metric is stored in `current.json` with the following structure:

```json
{
  "quality": {
    "slowTests": {
      "thresholdMs": 10000,
      "count": 3,
      "bySuite": {
        "unit": {
          "count": 2,
          "top": [
            { "name": "test1", "durationMs": 15000 },
            { "name": "test2", "durationMs": 12000 }
          ]
        },
        "pw_installer": {
          "count": 1,
          "top": [
            { "name": "e2e test", "durationMs": 20000 }
          ]
        },
        "pw_smoke": {
          "count": 0,
          "top": []
        }
      }
    }
  }
}
```

## Fields

- **`thresholdMs`**: The threshold in milliseconds (10000 = 10 seconds)
- **`count`**: Total number of slow tests across all suites (unit + E2E)
- **`bySuite`**: Breakdown by test suite type
  - **`unit`**: Slow tests from unit test suite
  - **`pw_installer`**: Slow tests from E2E installer suite
  - **`pw_smoke`**: Slow tests from E2E smoke suite
  - Each suite contains:
    - **`count`**: Number of slow tests in this suite
    - **`top`**: Array of up to 10 slowest tests with name and duration

## CI Output

When metrics are collected, the CI logs show:

```
[metrics] quality: coverage(lines%) 63.28 ; slowTests(>10s, unit+e2e) 3 ; duplication(%) 8.78
[metrics] slowTests breakdown: unit=2, pw_installer=1, pw_smoke=0
```

## PR Comment Display

The metric appears in PR comments as:

```
| 🐢 Slow tests (>10s) | 3 | +1 |
```

The threshold is dynamically rendered from `thresholdMs`, so if the threshold changes in the future, the display will automatically update.

## Implementation Details

### Code Location

- **Collection**: `src/ci/collect-metrics.mjs` (lines 642-696)
- **PR Comment Rendering**: `src/ci/render-pr-comment-dashboard.mjs` (line 271-275)
- **HTML Dashboard**: `src/ci/generate-metrics-report.mjs` (line 302-305)

### How It Works

1. The script parses test output from both unit and E2E test runs
2. For each test suite, it identifies tests with `durationMs > thresholdMs`
3. It aggregates the counts across all suites
4. It stores the top 10 slowest tests per suite for debugging

### Skipped Tests

Skipped tests are excluded from the slow tests calculation, as they don't represent actual execution time.

## Historical Context

- **2025-12-30**: Threshold changed from 20s to 10s
- **2025-12-30**: Added explicit documentation that metric includes both Unit and E2E tests
