#!/usr/bin/env node
/**
 * Compare `tests/perf/baseline-snapshot.json` with `tests/perf/playwright-snapshot.json`.
 *
 * Usage:
 *   npx tsx scripts/compare-baseline.ts --md
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

type BaselineSnapshot = {
  kind: 'baseline';
  capturedAtUtc: string;
  totalWallTimeMs: number;
  timings: Array<{ id: string; durationMs: number }>;
  smoke: { fastestPercent: number; ids: string[] };
};

type PlaywrightSnapshot = {
  kind: 'playwright';
  capturedAtUtc: string;
  totalWallTimeMs: number;
  testCount: number;
  smokeCount: number;
  timings: Array<{ id: string; durationMs: number; isSmoke: boolean }>;
};

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function sumMs(arr: Array<{ durationMs: number }>): number {
  return Math.round(arr.reduce((acc, t) => acc + t.durationMs, 0));
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

function main(): void {
  const perfDir = path.join(process.cwd(), 'tests', 'perf');
  const baseline = readJson<BaselineSnapshot>(path.join(perfDir, 'baseline-snapshot.json'));
  const pw = readJson<PlaywrightSnapshot>(path.join(perfDir, 'playwright-snapshot.json'));

  if (!hasFlag('--md')) {
    // eslint-disable-next-line no-console
    console.log('Use --md to print a Markdown report.');
    return;
  }

  const baselineAvg = baseline.timings.length ? sumMs(baseline.timings) / baseline.timings.length : 0;
  const pwAvg = pw.timings.length ? sumMs(pw.timings) / pw.timings.length : 0;
  const smokeMs = sumMs(pw.timings.filter(t => t.isSmoke));

  const lines: string[] = [];
  lines.push('# Baseline vs Playwright timing comparison');
  lines.push('');
  lines.push(`- Baseline captured: ${baseline.capturedAtUtc}`);
  lines.push(`- Playwright captured: ${pw.capturedAtUtc}`);
  lines.push('');
  lines.push('| Metric | Baseline | Playwright |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Total tests | ${baseline.timings.length} | ${pw.testCount} |`);
  lines.push(`| Wall time | ${baseline.totalWallTimeMs} ms | ${pw.totalWallTimeMs} ms |`);
  lines.push(`| Avg test duration | ${baselineAvg.toFixed(1)} ms | ${pwAvg.toFixed(1)} ms |`);
  lines.push(`| Smoke tests | ${baseline.smoke.ids.length} | ${pw.smokeCount} |`);
  lines.push(`| Smoke duration (sum of per-test) | n/a | ${smokeMs} ms |`);
  lines.push('');

  process.stdout.write(lines.join('\n') + '\n');
}

main();

