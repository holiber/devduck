# Frozen Smoke Test Group (Fastest 20%)

**Created:** 2025-12-28  
**Total Smoke Tests:** 13 tests (top 20% fastest from baseline)

## Purpose

This is a frozen list of the fastest 20% of installer tests, used as a smoke test group.
These tests are tagged with `@smoke` in their Playwright test titles.

## Running Smoke Tests

```bash
npm run test:smoke
```

## Frozen Test List

The following tests are permanently tagged as `@smoke`:

### install-project-scripts.pw.spec.ts (5 tests)
1. `@smoke Install default scripts from project` - 3.29ms (baseline)
2. `@smoke Install additional scripts via importScripts` - 2.07ms (baseline)
3. `@smoke Remove scripts when project is removed from config` - 2.16ms (baseline)
4. `@smoke Handle missing project package.json gracefully` - 2.23ms (baseline)
5. `@smoke Verify scripts do not change current directory` - 1.83ms (baseline)

### install-steps.pw.spec.ts (7 tests)
1. `@smoke Step 1: Check Environment Variables` - 43.70ms (baseline)
2. `@smoke Step 2: Download Repos` - 3.14ms (baseline)
3. `@smoke Step 3: Download Projects` - 3.88ms (baseline)
4. `@smoke Step 4: Check Environment Again` - 11.33ms (baseline)
5. `@smoke Step 5: Setup Modules` - 14.32ms (baseline)
6. `@smoke Step 6: Setup Projects` - 1.66ms (baseline)
7. `@smoke Step 7: Verify Installation` - 15.98ms (baseline)

### module-patterns.pw.spec.ts (1 test)
1. `@smoke modules: ["issue-*"] expands to issue-tracker and issue-tracker-github` - 17.03ms (baseline)

## Notes

- These tests represent the fastest 20% of all installer tests based on baseline timings
- The `@smoke` tag is the source of truth for which tests are in the smoke group
- Total baseline duration of smoke tests: ~107ms (out of ~8900ms total)
- These tests run in under 1 second with Playwright
