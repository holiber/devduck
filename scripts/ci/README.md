# CI Scripts

This directory contains scripts for collecting metrics and artifacts in CI/CD pipelines.

## Scripts

### `collect-metrics.ts`

Collects comprehensive metrics about the codebase and test runs:

- **Build metrics**: Build time, bundle size
- **Test metrics**: Test execution time, test counts, pass/fail ratios
- **Git metrics**: Code additions/deletions
- **Playwright metrics**: E2E test results

**Usage:**
```bash
tsx scripts/ci/collect-metrics.ts
```

**Output:**
- `.cache/metrics/metrics.json` - JSON file with all collected metrics
- `.cache/logs/*.log` - Individual log files for each step

### `ai-logger.ts`

Logs AI agent interactions and decisions during development and CI/CD:

**Commands:**

```bash
# Create a new AI session
tsx scripts/ci/ai-logger.ts create-session cursor-ai

# Log an action
tsx scripts/ci/ai-logger.ts log-action <session_id> "action description" '{"context":"data"}'

# End a session
tsx scripts/ci/ai-logger.ts end-session <session_id> "summary text"

# Create a simple log (useful for CI)
tsx scripts/ci/ai-logger.ts simple-log cursor-ai "PR analysis complete" '{"pr":123}'
```

**Output:**
- `.cache/ai_logs/*.json` - Session logs and simple log entries

## Workflow Integration

These scripts are automatically run by the `.github/workflows/pr-metrics.yml` workflow on every PR.

## Metrics Output Format

The `metrics.json` file contains:

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
  "commit_sha": "abc123..."
}
```

## AI Log Format

The AI session logs follow this structure:

```json
{
  "session_id": "cursor-ai-1234567890-abc",
  "started_at": "2025-12-28T12:00:00.000Z",
  "ended_at": "2025-12-28T12:05:00.000Z",
  "agent_name": "cursor-ai",
  "entries": [
    {
      "agent": "cursor-ai",
      "action": "analyze_code",
      "timestamp": "2025-12-28T12:01:00.000Z",
      "context": {
        "files": ["src/index.ts"]
      },
      "result": "Found 3 issues"
    }
  ],
  "summary": "Completed code analysis and suggested fixes"
}
```

## Extending

To add new metrics:

1. Add a new `collect*Metrics()` function in `collect-metrics.ts`
2. Update the `Metrics` interface
3. Call the function from `main()`

To customize AI logging:

1. Use the exported functions from `ai-logger.ts` in your code
2. Or extend the CLI commands in the `main()` function
