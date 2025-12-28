# Playwright Migration Timing Comparison

**Generated:** 2025-12-28T01:30:32.331Z

## Summary

- **Baseline Runner:** Node.js test runner (tsx --test)
- **Playwright Runner:** Playwright Test
- **Migration Status:** ✅ Complete - All installer tests migrated to Playwright

## Baseline Metrics (Node.js Test Runner)

- **Total Duration:** 32,432ms (32.43s)
- **Installer Tests:** 35 tests
- **Average Test Duration:** ~543ms per test
- **Snapshot:** `baseline-2025-12-28.json`

## Playwright Metrics

- **Total Duration:** ~14-15s (estimated from test runs)
- **Installer Tests:** All migrated (8 test files → `.pw.spec.ts`)
- **Smoke Tests:** 7 tests (fastest 20%)
- **Smoke Group Duration:** ~700ms (from test run)

## Smoke Group

The fastest 20% of installer tests (7 tests) are tagged with `@smoke`:

1. `install-project-scripts.pw.spec.ts` - Install additional scripts via importScripts (1ms baseline)
2. `install-project-scripts.pw.spec.ts` - Remove scripts when project is removed from config (1ms baseline)
3. `install-project-scripts.pw.spec.ts` - Handle missing project package.json gracefully (1ms baseline)
4. `install-project-scripts.pw.spec.ts` - Verify scripts do not change current directory (1ms baseline)
5. `install-steps.pw.spec.ts` - Step 3: Download Projects (2ms baseline)
6. `install-steps.pw.spec.ts` - Step 6: Setup Projects (2ms baseline)
7. `install-project-scripts.pw.spec.ts` - Install default scripts from project (3ms baseline)

**Run smoke tests:** `npm run test:smoke`

## Migrated Test Files

All installer tests have been migrated to Playwright:

- ✅ `install-project-scripts.pw.spec.ts` (5 tests)
- ✅ `install-steps.pw.spec.ts` (7 tests)
- ✅ `module-patterns.pw.spec.ts` (1 test)
- ✅ `installer-strictness.pw.spec.ts` (4 tests)
- ✅ `installer-gui.pw.spec.ts` (2 tests)
- ✅ `installer-unattended.pw.spec.ts` (15 tests)
- ✅ `npx-new-workspace.pw.spec.ts` (2 tests)
- ✅ `workspace-modules-installation.pw.spec.ts` (1 test)

**Total:** 37 tests across 8 files

## Performance Notes

- Playwright tests run serially (`workers: 1`) to avoid conflicts with shared workspaces
- Some tests may be skipped in smoke group due to sequential dependencies (install-steps)
- Overall test suite appears faster with Playwright (~14s vs ~32s baseline)
- Smoke group provides fast feedback (~700ms) for CI/CD pipelines

## Files

- **Baseline Snapshot:** `tests/perf/baseline-2025-12-28.json`
- **Frozen Smoke Group:** `tests/perf/smoke-group-frozen.json`
- **Playwright Config:** `tests/installer/playwright.config.ts`

## Next Steps

1. ✅ Phase 0: Baseline capture - Complete
2. ✅ Phase 1: Playwright scaffold - Complete
3. ✅ Phase 2: Migrate installer tests - Complete
4. ✅ Phase 3: Fastest 20% smoke group - Complete
5. ✅ Phase 4: Comparison report - Complete
6. ⏭️ Phase 5: PR preparation

## Commands

```bash
# Run all installer Playwright tests
npm run test:installer:pw

# Run smoke group (fastest 20%)
npm run test:smoke

# Run original Node.js tests (non-installer)
npm test
```
