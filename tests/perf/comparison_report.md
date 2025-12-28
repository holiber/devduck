# Playwright Migration Comparison Report

## Baseline (Node Test Runner)
- **Installer Tests Duration**: 14.64s
- **Total Tests**: 33
- **Source**: `tests/perf/baseline.json`

## Playwright Migration
- **Installer Tests Duration**: 10.0s
- **Improvement**: ~31% faster
- **Workers**: 2

## Smoke Tests (Fastest 20%)
- **Test Count**: 7
- **Duration**: 0.88s
- **Command**: `npm run test:smoke`

## Remaining Tests (Node Test Runner)
- **Duration**: 13.59s
