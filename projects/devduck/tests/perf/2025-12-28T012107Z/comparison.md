## Timing comparison (installer Playwright migration)

Baseline snapshot: `projects/devduck/tests/perf/2025-12-28T011222Z`  
Post-migration snapshot: `projects/devduck/tests/perf/2025-12-28T012107Z`

### Measured wall-clock durations

All values are measured as \(end-start\) in ms around each command invocation.

| Suite | Baseline (ms) | Post-migration (ms) | Notes |
|---|---:|---:|---|
| Current runner (`npm test`) | 34143 | 14041 | Baseline included installer tests; post-migration excludes installer tests (they moved to Playwright). |
| Installer-only (current runner) | 16778 | n/a | Baseline command: `npx tsx --test --test-concurrency=1 tests/installer/*.test.ts` (pre-migration). |
| Playwright installer suite | n/a | 15733 | Command: `npm run test:installer:pw`. |
| Playwright smoke (@smoke) | n/a | 1367 | Command: `npm run test:smoke`. |

### Combined "all tests" view

- **Baseline all tests**: 34143ms
- **Post-migration combined**: \(node runner 14041ms + Playwright installer 15733ms\) = **29774ms**
- **Delta**: **-4369ms** (~12.8% faster)

