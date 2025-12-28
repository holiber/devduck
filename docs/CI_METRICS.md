# CI Metrics and Artifacts System

This document describes the comprehensive CI metrics and artifacts collection system for the devduck project.

## Overview

The CI system automatically collects, tracks, and reports on various metrics for every Pull Request, including:

- **Code metrics**: Lines added/deleted, files changed
- **Build metrics**: Build time, bundle size
- **Test metrics**: Test execution time, pass/fail counts
- **Playwright metrics**: E2E test results, screenshots, videos
- **AI agent logs**: Agent interactions and decisions

## Architecture

```
┌─────────────────┐
│   Pull Request  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  GitHub Actions: pr-metrics.yml          │
├─────────────────────────────────────────┤
│                                          │
│  1. Checkout & Setup                     │
│  2. Install Dependencies                 │
│  3. Collect Metrics                      │
│     ├─ Run tests                         │
│     ├─ Measure build time                │
│     ├─ Calculate bundle size             │
│     └─ Run Playwright tests              │
│  4. Collect Artifacts                    │
│     ├─ Logs                              │
│     ├─ Screenshots (failed tests)        │
│     ├─ Videos (failed tests)             │
│     └─ AI agent logs                     │
│  5. Upload Artifacts                     │
│  6. Comment on PR with Summary           │
│                                          │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  PR Comment     │
│  with Metrics   │
└─────────────────┘
```

## Workflows

### Primary Workflow: `pr-metrics.yml`

Triggered on: Pull Request (opened, synchronize, reopened)

**Jobs:**

1. **metrics** - Collects all metrics and artifacts
2. **comment** - Posts results to PR

## Scripts

### `scripts/ci/collect-metrics.ts`

Main metrics collection script that gathers:

- Test execution time and results
- Build time and bundle size
- Git diff statistics
- Playwright test results

**Usage:**
```bash
npm run ci:metrics
# or
tsx scripts/ci/collect-metrics.ts
```

**Output:**
- `.cache/metrics/metrics.json` - All collected metrics
- `.cache/logs/*.log` - Individual step logs

### `scripts/ci/ai-logger.ts`

Logs AI agent interactions during development and CI.

**Usage:**
```bash
# Create a session
npm run ci:ai-log create-session cursor-ai

# Log an action
npm run ci:ai-log log-action <session_id> "action" '{"key":"value"}'

# End session
npm run ci:ai-log end-session <session_id> "summary"

# Simple log (for CI)
npm run ci:ai-log simple-log cursor-ai "PR analysis done"
```

**Output:**
- `.cache/ai_logs/*.json` - Session logs

### `scripts/ci/compare-metrics.ts`

Compares metrics between two runs to detect regressions.

**Usage:**
```bash
npm run ci:compare .cache/metrics/metrics.json baseline.json
```

**Output:**
- Console table with comparison
- `.cache/metrics/comparison-report.md` - Markdown report
- Exit code 1 if regressions detected

### `scripts/ci/visualize-metrics.ts`

Generates ASCII charts and trends from historical metrics.

**Usage:**
```bash
npm run ci:visualize
# or
npm run ci:visualize path/to/metrics/directory
```

**Output:**
- ASCII charts in console
- `.cache/metrics/metrics-summary.md` - Summary report

## Metrics Format

The `metrics.json` file structure:

```json
{
  "timestamp": "2025-12-28T12:00:00.000Z",
  "build_time_sec": 45.2,
  "test_time_sec": 12.8,
  "test_count": 42,
  "test_passed": 40,
  "test_failed": 2,
  "bundle_size_bytes": 1024000,
  "code_additions": 150,
  "code_deletions": 45,
  "playwright_tests": {
    "total": 10,
    "passed": 8,
    "failed": 2,
    "skipped": 0
  },
  "pr_number": 123,
  "pr_title": "Add new feature",
  "pr_additions": 150,
  "pr_deletions": 45,
  "pr_changed_files": 5,
  "pr_author": "username",
  "commit_sha": "abc123...",
  "errors": []
}
```

## Artifacts

All artifacts are uploaded to GitHub Actions and retained for 30 days:

### Directory Structure

```
.cache/
├── logs/
│   ├── build.log
│   ├── test.log
│   └── ...
├── metrics/
│   ├── metrics.json
│   ├── comparison-report.md
│   └── metrics-summary.md
├── ai_logs/
│   ├── cursor-ai-1234567890-abc.json
│   └── ai-log-1234567890.json
└── playwright/
    ├── test-results/
    │   └── [test-name]/
    │       ├── screenshot.png
    │       ├── video.webm
    │       └── trace.zip
    ├── playwright-report/
    └── summary.md
```

### Accessing Artifacts

1. Navigate to the PR
2. Scroll to the "Checks" section
3. Click on "PR Metrics & Artifacts"
4. Go to the "Summary" tab
5. Download artifacts from the "Artifacts" section

Or use the GitHub CLI:

```bash
# List artifacts for a run
gh run view <run-id>

# Download artifacts
gh run download <run-id>
```

## PR Comments

The workflow automatically posts a comment on each PR with a summary:

```markdown
### 🧠 PR Metrics Summary

| Metric | Value |
|--------|-------|
| 📊 **Code Changes** | +150 / -45 |
| 🧪 **Test Time** | 12.8s |
| 📦 **Build Time** | 45.2s |
| 📏 **Bundle Size** | 1000.00 KB |
| ✅ **Tests Passed** | 40 |
| ❌ **Tests Failed** | 2 |

### 🎭 Playwright Tests

## Failed Tests
- test-results/test-1/screenshot.png
- test-results/test-2/video.webm

---
🧩 **Artifacts:** Logs, screenshots, videos, and AI logs are available in workflow artifacts.

📈 **Full Report:** View detailed metrics
```

## Local Development

### Run metrics collection locally:

```bash
# Collect metrics
npm run ci:metrics

# Compare with baseline
npm run ci:compare .cache/metrics/metrics.json baseline.json

# Visualize trends
npm run ci:visualize
```

### Create baseline metrics:

```bash
# Run tests and collect metrics
npm run ci:metrics

# Copy as baseline
cp .cache/metrics/metrics.json baseline-metrics.json
git add baseline-metrics.json
git commit -m "Update baseline metrics"
```

## Configuration

### Adjust retention periods

Edit `.github/workflows/pr-metrics.yml`:

```yaml
- name: Upload all artifacts
  uses: actions/upload-artifact@v4
  with:
    retention-days: 30  # Change this value
```

### Add custom metrics

1. Edit `scripts/ci/collect-metrics.ts`
2. Add a new `collect*Metrics()` function
3. Update the `Metrics` interface
4. Call the function from `main()`

Example:

```typescript
interface Metrics {
  // ... existing fields
  my_custom_metric?: number;
}

async function collectCustomMetrics(metrics: Metrics): Promise<void> {
  console.log('📊 Collecting custom metrics...');
  
  try {
    // Your metric collection logic
    metrics.my_custom_metric = 42;
  } catch (error: any) {
    console.error('Error:', error.message);
    metrics.errors = metrics.errors || [];
    metrics.errors.push(`Custom: ${error.message}`);
  }
}

// In main():
await collectCustomMetrics(metrics);
```

## Troubleshooting

### Metrics collection fails

1. Check the workflow logs in GitHub Actions
2. Look at `.cache/logs/*.log` files
3. Check if `metrics.json` has an `errors` array

### No Playwright artifacts

1. Ensure tests actually ran: Check `.cache/logs/test.log`
2. Verify `test-results/` directory exists
3. Check if tests failed (artifacts only for failures by default)

### PR comment not posted

1. Check workflow permissions (needs `pull-requests: write`)
2. Verify the `comment` job ran successfully
3. Check if metrics.json was uploaded in the `metrics` job

## Best Practices

1. **Baseline metrics**: Keep a `baseline-metrics.json` in the repo for comparison
2. **Regression thresholds**: Use `compare-metrics.ts` in CI to fail on regressions
3. **Regular cleanup**: Archive old metrics to keep the repo clean
4. **Monitor trends**: Run `visualize-metrics.ts` weekly to spot trends
5. **Document changes**: Note significant metric changes in PR descriptions

## Future Enhancements

Potential improvements to consider:

- [ ] Store metrics in a database (e.g., PostgreSQL, InfluxDB)
- [ ] Create a web dashboard for metrics visualization
- [ ] Add performance budgets with automatic failures
- [ ] Integrate with monitoring tools (Datadog, New Relic)
- [ ] Add metrics for code coverage
- [ ] Track memory usage and CPU profiling
- [ ] Add lighthouse scores for web performance
- [ ] Create Slack/Discord notifications for regressions

## References

- [GitHub Actions - Artifacts](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts)
- [Playwright Test Reports](https://playwright.dev/docs/test-reporters)
- [Performance Budgets](https://web.dev/performance-budgets-101/)
