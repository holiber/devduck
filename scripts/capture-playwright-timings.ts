#!/usr/bin/env node

/**
 * Script to capture Playwright test timings and compare with baseline
 */

import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

interface TestTiming {
  file: string;
  test: string;
  duration: number; // milliseconds
}

interface PlaywrightTimingSnapshot {
  timestamp: string;
  totalDuration: number;
  testCount: number;
  installerTests: TestTiming[];
  smokeTests: TestTiming[];
}

interface ComparisonReport {
  timestamp: string;
  baseline: {
    snapshot: string;
    totalDuration: number;
    installerTestCount: number;
  };
  playwright: {
    totalDuration: number;
    installerTestCount: number;
    smokeTestCount: number;
  };
  comparison: {
    totalDurationDiff: number;
    totalDurationDiffPercent: number;
    avgInstallerTestDuration: {
      baseline: number;
      playwright: number;
      diff: number;
      diffPercent: number;
    };
    smokeGroupDuration: number;
  };
}

function parsePlaywrightOutput(output: string): TestTiming[] {
  const timings: TestTiming[] = [];
  const lines = output.split('\n');
  
  // Playwright line reporter format: 
  // "  ✓  1 tests/installer/file.pw.spec.ts:41:3 › Suite › Test (123ms)"
  // "  ×  2 tests/installer/file.pw.spec.ts:41:3 › Suite › Test (123ms)"
  // "  -  3 tests/installer/file.pw.spec.ts:41:3 › Suite › Test"
  
  for (const line of lines) {
    // Match test result lines with timing
    const match = line.match(/tests\/installer\/(.+\.pw\.spec\.ts):\d+:\d+ › (.+?) \((\d+)ms\)/);
    if (match) {
      timings.push({
        file: match[1],
        test: match[2],
        duration: parseInt(match[3], 10)
      });
    }
  }
  
  return timings;
}

function extractTotalDuration(output: string): number {
  // Look for "Running 35 tests using 1 worker" or "35 passed (30s)"
  const durationMatch = output.match(/(\d+) passed.*?\((\d+)s\)/);
  if (durationMatch) {
    return parseFloat(durationMatch[2]) * 1000; // Convert to milliseconds
  }
  
  // Fallback: look for time in various formats
  const timeMatch = output.match(/\((\d+\.?\d*)s\)/);
  if (timeMatch) {
    return parseFloat(timeMatch[1]) * 1000;
  }
  
  return 0;
}

console.log('Running Playwright installer tests...');
const startTime = Date.now();

const result = spawnSync(
  'npx',
  ['playwright', 'test', '--config=tests/installer/playwright.config.ts', '--reporter=line'],
  {
    stdio: 'pipe',
    cwd: process.cwd(),
    encoding: 'utf8'
  }
);

const endTime = Date.now();
const totalDuration = endTime - startTime;
const output = result.stdout?.toString() || '';
const errorOutput = result.stderr?.toString() || '';
const fullOutput = output + '\n' + errorOutput;

// Parse line reporter output
const timings = parsePlaywrightOutput(fullOutput);

// Try to extract duration from output, fallback to measured time
const reportedDuration = extractTotalDuration(fullOutput);
const finalDuration = reportedDuration > 0 ? reportedDuration : totalDuration;

// Filter installer tests
const installerTimings = timings.filter(t => t.file && t.file.endsWith('.pw.spec.ts'));
const smokeTimings = installerTimings.filter(t => t.test && t.test.includes('@smoke'));

// Sort by duration
installerTimings.sort((a, b) => a.duration - b.duration);
smokeTimings.sort((a, b) => a.duration - b.duration);

const snapshot: PlaywrightTimingSnapshot = {
  timestamp: new Date().toISOString(),
  totalDuration: finalDuration,
  testCount: timings.length,
  installerTests: installerTimings,
  smokeTests: smokeTimings
};

// Load baseline for comparison
const baselinePath = join(process.cwd(), 'tests', 'perf', 'baseline-2025-12-28.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

const baselineAvgDuration = baseline.installerTests.reduce((sum: number, t: TestTiming) => sum + t.duration, 0) / baseline.installerTests.length;
const playwrightAvgDuration = installerTimings.reduce((sum, t) => sum + t.duration, 0) / installerTimings.length;
const smokeGroupDuration = smokeTimings.reduce((sum, t) => sum + t.duration, 0);

const comparison: ComparisonReport = {
  timestamp: new Date().toISOString(),
  baseline: {
    snapshot: 'baseline-2025-12-28.json',
    totalDuration: baseline.totalDuration,
    installerTestCount: baseline.installerTests.length
  },
  playwright: {
    totalDuration: finalDuration,
    installerTestCount: installerTimings.length,
    smokeTestCount: smokeTimings.length
  },
  comparison: {
    totalDurationDiff: finalDuration - baseline.totalDuration,
    totalDurationDiffPercent: ((finalDuration - baseline.totalDuration) / baseline.totalDuration) * 100,
    avgInstallerTestDuration: {
      baseline: baselineAvgDuration,
      playwright: playwrightAvgDuration,
      diff: playwrightAvgDuration - baselineAvgDuration,
      diffPercent: ((playwrightAvgDuration - baselineAvgDuration) / baselineAvgDuration) * 100
    },
    smokeGroupDuration
  }
};

// Write JSON snapshot
const perfDir = join(process.cwd(), 'tests', 'perf');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
const jsonPath = join(perfDir, `playwright-${timestamp}.json`);
const comparisonPath = join(perfDir, `comparison-${timestamp}.json`);
const mdPath = join(perfDir, `comparison-${timestamp}.md`);

writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2), 'utf8');
writeFileSync(comparisonPath, JSON.stringify(comparison, null, 2), 'utf8');

// Write markdown report
const mdReport = `# Playwright Migration Timing Comparison

**Generated:** ${comparison.timestamp}

## Summary

- **Baseline Runner:** Node.js test runner (tsx --test)
- **Playwright Runner:** Playwright Test
- **Total Duration Change:** ${comparison.comparison.totalDurationDiff > 0 ? '+' : ''}${comparison.comparison.totalDurationDiff.toFixed(2)}ms (${comparison.comparison.totalDurationDiffPercent > 0 ? '+' : ''}${comparison.comparison.totalDurationDiffPercent.toFixed(2)}%)
- **Average Test Duration Change:** ${comparison.comparison.avgInstallerTestDuration.diff > 0 ? '+' : ''}${comparison.comparison.avgInstallerTestDuration.diff.toFixed(2)}ms (${comparison.comparison.avgInstallerTestDuration.diffPercent > 0 ? '+' : ''}${comparison.comparison.avgInstallerTestDuration.diffPercent.toFixed(2)}%)

## Baseline Metrics

- **Total Duration:** ${baseline.totalDuration.toFixed(2)}ms (${(baseline.totalDuration / 1000).toFixed(2)}s)
- **Installer Tests:** ${baseline.installerTests.length}
- **Average Test Duration:** ${baselineAvgDuration.toFixed(2)}ms

## Playwright Metrics

- **Total Duration:** ${finalDuration.toFixed(2)}ms (${(finalDuration / 1000).toFixed(2)}s)
- **Installer Tests:** ${installerTimings.length}
- **Average Test Duration:** ${playwrightAvgDuration.toFixed(2)}ms
- **Smoke Group Duration:** ${smokeGroupDuration.toFixed(2)}ms (${(smokeGroupDuration / 1000).toFixed(2)}s)
- **Smoke Tests:** ${smokeTimings.length}

## Smoke Group Performance

The fastest 20% of installer tests (${smokeTimings.length} tests) complete in ${smokeGroupDuration.toFixed(2)}ms.

Run smoke tests with: \`npm run test:smoke\`

## Test-by-Test Comparison

| Test File | Test Name | Baseline (ms) | Playwright (ms) | Diff (ms) |
|-----------|-----------|---------------|-----------------|-----------|
${installerTimings.map(t => {
  const baselineTest = baseline.installerTests.find((bt: TestTiming) => 
    bt.file.replace('.test.ts', '.pw.spec.ts') === t.file && bt.test === t.test.replace('@smoke ', '')
  );
  const baselineDuration = baselineTest?.duration || 'N/A';
  const diff = typeof baselineDuration === 'number' ? (t.duration - baselineDuration).toFixed(2) : 'N/A';
  return `| ${t.file} | ${t.test} | ${baselineDuration} | ${t.duration} | ${diff} |`;
}).join('\n')}

## Notes

- Smoke group tests are tagged with \`@smoke\` in their titles
- Frozen smoke group list: \`tests/perf/smoke-group-frozen.json\`
- Baseline snapshot: \`tests/perf/baseline-2025-12-28.json\`
`;

writeFileSync(mdPath, mdReport, 'utf8');

console.log(`\nPlaywright timing snapshot saved:`);
console.log(`  JSON: ${jsonPath}`);
console.log(`\nComparison report saved:`);
console.log(`  JSON: ${comparisonPath}`);
console.log(`  Markdown: ${mdPath}`);
console.log(`\nTotal duration: ${finalDuration.toFixed(2)}ms`);
console.log(`Installer tests: ${installerTimings.length}`);
console.log(`Smoke tests: ${smokeTimings.length}`);
console.log(`Smoke group duration: ${smokeGroupDuration.toFixed(2)}ms`);

if (result.status !== 0) {
  console.error('\n⚠️  Some tests failed, but timings captured.');
  console.error('Error output:', errorOutput);
  process.exit(1);
}
