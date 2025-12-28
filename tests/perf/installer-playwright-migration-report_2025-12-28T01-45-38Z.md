# Installer → Playwright migration timing report

Generated: 2025-12-28T01:49:22.198Z

## Inputs
- Baseline (before migration): `tests/perf/node-test-baseline_2025-12-28T01-27-01Z.meta.json`
- node:test after (installer removed): `tests/perf/node-test-after-installer-migration_2025-12-28T01-45-38Z.meta.json`
- Playwright installer JSON: `tests/perf/playwright-installer_2025-12-28T01-45-38Z.json`
- Playwright smoke JSON: `tests/perf/playwright-smoke_2025-12-28T01-45-38Z.json`

## Wall times
- node:test baseline (included installer): **64.00s**
- node:test after (installer removed): **36.84s**
- Playwright installer suite: **28.88s**
- Playwright smoke (@smoke): **0.92s**

Combined (node:test after + PW installer): **65.72s**
Delta vs baseline: **+1.72s**

## Notes
- Playwright wall time comes from JSON reporter `stats.duration` (ms).
- node:test wall time is parsed from TAP summary `# duration_ms`.
- Smoke group uses `--grep @smoke` and should be runnable standalone (no skips).
