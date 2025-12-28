# CI Metrics System - Setup Guide

This guide will help you set up and configure the CI Metrics and Artifacts system for your devduck repository.

## Prerequisites

- GitHub repository with Actions enabled
- Node.js 20+ installed
- npm or yarn package manager
- Playwright installed (automatically via postinstall)

## Quick Setup (5 minutes)

### 1. Verify Files

All necessary files should already be in place:

```bash
# Check if files exist
ls -la .github/workflows/pr-metrics.yml
ls -la scripts/ci/
ls -la docs/CI_METRICS.md
```

### 2. Test Locally

Run the metrics collector to ensure everything works:

```bash
# Install dependencies (if not already done)
npm ci

# Test metrics collection
npx tsx scripts/ci/collect-metrics.ts

# Check the output
cat .cache/metrics/metrics.json

# Test AI logger
npx tsx scripts/ci/ai-logger.ts simple-log "test-agent" "Setup test"

# Verify AI log was created
ls -la .cache/ai_logs/
```

### 3. Create Baseline Metrics (Optional but Recommended)

Create a baseline for comparison:

```bash
# Collect current metrics
npx tsx scripts/ci/collect-metrics.ts

# Save as baseline
cp .cache/metrics/metrics.json baseline-metrics.json

# Commit baseline
git add baseline-metrics.json
git commit -m "Add baseline metrics"
git push
```

### 4. Enable GitHub Actions

The workflows are already configured and will run automatically on PRs. To verify:

1. Go to your repository on GitHub
2. Click on the "Actions" tab
3. You should see "PR Metrics & Artifacts" in the list

### 5. Test with a Pull Request

Create a test PR to verify the system works:

```bash
# Create a test branch
git checkout -b test/ci-metrics

# Make a small change
echo "# CI Test" >> test-ci.md

# Commit and push
git add test-ci.md
git commit -m "Test CI metrics system"
git push -u origin test/ci-metrics

# Create PR
gh pr create --title "Test: CI Metrics" --body "Testing the CI metrics system"
```

The workflow will:
1. Run automatically
2. Collect metrics
3. Run tests
4. Upload artifacts
5. Post a comment on the PR

### 6. Review Results

After the workflow completes:

1. Check the PR for the automated comment with metrics
2. Go to the workflow run and download artifacts
3. Review the metrics, logs, and any Playwright reports

## Configuration

### Adjust Artifact Retention

Edit `.github/workflows/pr-metrics.yml`:

```yaml
- name: Upload all artifacts
  uses: actions/upload-artifact@v4
  with:
    retention-days: 30  # Change to 7, 14, 30, or 90
```

### Add GitHub Token Permissions

If the workflow fails to post comments, ensure proper permissions in `.github/workflows/pr-metrics.yml`:

```yaml
permissions:
  contents: read
  pull-requests: write  # Required for commenting
```

### Customize Metrics Collection

Edit `scripts/ci/collect-metrics.ts` to add custom metrics:

```typescript
interface Metrics {
  // Add your custom metric
  my_custom_metric?: number;
}

async function collectCustomMetrics(metrics: Metrics): Promise<void> {
  console.log('📊 Collecting custom metrics...');
  
  try {
    // Your collection logic
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

## Workflow Files

### `.github/workflows/pr-metrics.yml`

Main workflow that runs on every PR:

- **Trigger**: Pull request (opened, synchronize, reopened)
- **Jobs**: 
  - `metrics` - Collects all metrics and artifacts
  - `comment` - Posts results to PR
- **Timeout**: 20 minutes
- **Artifacts Retention**: 30 days

### `.github/workflows/ci.yml`

Basic CI workflow:

- **Trigger**: Push to main, Pull request
- **Jobs**: `test` - Runs npm test

## Scripts Overview

### `scripts/ci/collect-metrics.ts`

Main metrics collector:

```bash
# Run manually
npx tsx scripts/ci/collect-metrics.ts

# Through npm
npm run ci:metrics
```

**Output:**
- `.cache/metrics/metrics.json`
- `.cache/logs/*.log`

### `scripts/ci/ai-logger.ts`

AI agent logger:

```bash
# Create a session
npx tsx scripts/ci/ai-logger.ts create-session cursor-ai

# Log action
npx tsx scripts/ci/ai-logger.ts log-action SESSION_ID "action" '{"key":"value"}'

# Simple log (for CI)
npx tsx scripts/ci/ai-logger.ts simple-log cursor-ai "Message" '{"metadata":"value"}'

# Through npm
npm run ci:ai-log simple-log cursor-ai "Message"
```

**Output:**
- `.cache/ai_logs/*.json`

### `scripts/ci/compare-metrics.ts`

Compare two metrics files:

```bash
# Compare current with baseline
npx tsx scripts/ci/compare-metrics.ts .cache/metrics/metrics.json baseline-metrics.json

# Through npm
npm run ci:compare .cache/metrics/metrics.json baseline-metrics.json
```

**Output:**
- Console table
- `.cache/metrics/comparison-report.md`
- Exit code 1 if regressions detected

### `scripts/ci/visualize-metrics.ts`

Visualize metrics trends:

```bash
# Visualize from default directory
npx tsx scripts/ci/visualize-metrics.ts

# From specific directory
npx tsx scripts/ci/visualize-metrics.ts path/to/metrics/

# Through npm
npm run ci:visualize
```

**Output:**
- ASCII charts in console
- `.cache/metrics/metrics-summary.md`

## Common Issues

### "tsx: command not found"

Use `npx tsx` instead of just `tsx`:

```bash
npx tsx scripts/ci/collect-metrics.ts
```

### Workflow Permission Error

Add permissions to workflow file:

```yaml
permissions:
  contents: read
  pull-requests: write
```

### No Artifacts Uploaded

Check if `.cache` directories exist:

```bash
mkdir -p .cache/{logs,metrics,ai_logs,playwright}
```

### Metrics Collection Fails

Check logs:

```bash
cat .cache/logs/test.log
cat .cache/logs/build.log
```

Review the metrics file for errors:

```bash
cat .cache/metrics/metrics.json | jq '.errors'
```

## Best Practices

### 1. Keep Baseline Updated

Update baseline metrics after significant changes:

```bash
# After major refactoring
npm run ci:metrics
cp .cache/metrics/metrics.json baseline-metrics.json
git add baseline-metrics.json
git commit -m "Update baseline metrics after refactoring"
```

### 2. Monitor Trends Weekly

Run visualization weekly to spot trends:

```bash
npm run ci:visualize
```

### 3. Set Performance Budgets

Use comparison to enforce budgets:

```yaml
# In your workflow
- name: Check performance budget
  run: npm run ci:compare .cache/metrics/metrics.json baseline-metrics.json
  # Will fail if regressions detected
```

### 4. Archive Old Metrics

Keep the repo clean:

```bash
# Archive metrics older than 90 days
mkdir -p archived-metrics
mv .cache/metrics/metrics-*.json archived-metrics/
```

### 5. Document Significant Changes

When metrics change significantly, document why:

```markdown
## PR #123 - Performance Optimization

### Metrics Changes
- Build time: 45s → 32s (-29%)
- Bundle size: 1MB → 800KB (-20%)

### Reason
- Implemented lazy loading
- Removed unused dependencies
- Optimized webpack configuration
```

## Integration with Other Tools

### Slack Notifications

Add to your workflow:

```yaml
- name: Notify Slack
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "CI Metrics failed for PR #${{ github.event.pull_request.number }}"
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

### Datadog Integration

Send metrics to Datadog:

```typescript
// In collect-metrics.ts
import { client } from 'dd-trace';

// After collecting metrics
client.gauge('ci.build_time', metrics.build_time_sec);
client.gauge('ci.test_time', metrics.test_time_sec);
client.gauge('ci.bundle_size', metrics.bundle_size_bytes);
```

### GitHub Status Checks

Add a status check based on metrics:

```yaml
- name: Check metrics thresholds
  run: |
    BUILD_TIME=$(jq -r '.build_time_sec' .cache/metrics/metrics.json)
    if (( $(echo "$BUILD_TIME > 60" | bc -l) )); then
      echo "❌ Build time exceeds 60s threshold"
      exit 1
    fi
```

## Next Steps

1. ✅ Verify local setup works
2. ✅ Create baseline metrics
3. ✅ Test with a PR
4. ✅ Review artifacts
5. ⬜ Customize for your needs
6. ⬜ Add custom metrics
7. ⬜ Set up performance budgets
8. ⬜ Integrate with monitoring tools

## Support

If you encounter issues:

1. Check [CI_METRICS.md](./CI_METRICS.md) for detailed documentation
2. Review workflow logs in GitHub Actions
3. Check `.cache/logs/` for error details
4. Look at `metrics.json` for the `errors` array

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Playwright Test Reports](https://playwright.dev/docs/test-reporters)
- [Performance Budgets](https://web.dev/performance-budgets-101/)
