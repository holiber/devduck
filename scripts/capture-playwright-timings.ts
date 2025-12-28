#!/usr/bin/env node
/**
 * Capture Playwright installer suite timings and (optionally) compare to baseline.
 *
 * Intended CI usage:
 *   npx tsx scripts/capture-playwright-timings.ts --md > tests/perf/timing-comparison.md
 *
 * Local usage:
 *   npm run test:installer:pw
 *   npx tsx scripts/capture-playwright-timings.ts
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type PwTiming = { id: string; durationMs: number; isSmoke: boolean };

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
  timings: PwTiming[];
};

function utcNow(): string {
  return new Date().toISOString();
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readJsonIfExists<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

function parsePlaywrightListTimings(text: string): PwTiming[] {
  const out: PwTiming[] = [];
  for (const line of text.split(/\r?\n/)) {
    // Example:
    //   ✓  12 tests/installer/foo.pw.spec.ts:1:1 › Suite › test title @smoke (123ms)
    const m = /^\s*[✓✘-]\s+\d+\s+(.+)\s+\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/.exec(line);
    if (!m) continue;
    const id = (m[1] ?? '').trim();
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    const unit = m[3] ?? 'ms';
    const durationMs = unit === 'ms' ? value : unit === 's' ? value * 1000 : value * 60_000;
    out.push({ id, durationMs: Math.round(durationMs), isSmoke: id.includes('@smoke') });
  }
  return out;
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, '\\|');
}

function sumMs(arr: Array<{ durationMs: number }>): number {
  return Math.round(arr.reduce((acc, t) => acc + t.durationMs, 0));
}

function main(): void {
  const repoRoot = process.cwd();
  const perfDir = path.join(repoRoot, 'tests', 'perf');
  mkdirSync(perfDir, { recursive: true });

  const baselinePath = path.join(perfDir, 'baseline-snapshot.json');
  const baseline = readJsonIfExists<BaselineSnapshot>(baselinePath);

  const start = Date.now();
  const res = spawnSync(
    'npx',
    ['playwright', 'test', '-c', 'playwright.config.ts'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PW_TEST_HTML_REPORT_OPEN: 'never' }
    }
  );
  const wall = Date.now() - start;

  const stdout = res.stdout?.toString() ?? '';
  const stderr = res.stderr?.toString() ?? '';
  const combined = `${stdout}\n${stderr}`;

  writeFileSync(path.join(perfDir, 'playwright-run-output.txt'), combined, 'utf8');
  if (res.status !== 0) {
    throw new Error(`Playwright run failed (exit ${res.status}). See tests/perf/playwright-run-output.txt`);
  }

  const timings = parsePlaywrightListTimings(combined).sort((a, b) => a.durationMs - b.durationMs);
  const smoke = timings.filter(t => t.isSmoke);

  const snapshot: PlaywrightSnapshot = {
    kind: 'playwright',
    capturedAtUtc: utcNow(),
    totalWallTimeMs: wall,
    testCount: timings.length,
    smokeCount: smoke.length,
    timings
  };
  writeFileSync(path.join(perfDir, 'playwright-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  if (!hasFlag('--md')) {
    // eslint-disable-next-line no-console
    console.log(`Playwright timings captured: tests/perf/playwright-snapshot.json (${timings.length} tests, ${wall}ms wall time)`);
    return;
  }

  const smokeMs = sumMs(smoke);
  const baselineAvg =
    baseline && baseline.timings.length > 0 ? sumMs(baseline.timings) / baseline.timings.length : null;
  const pwAvg = timings.length > 0 ? sumMs(timings) / timings.length : null;

  const lines: string[] = [];
  lines.push('# Installer Tests Migration - Timing Comparison');
  lines.push('');
  lines.push(`**Generated:** ${snapshot.capturedAtUtc}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Baseline (legacy Node.js) | Playwright |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| Total tests | ${baseline?.timings?.length ?? 'n/a'} | ${snapshot.testCount} |`);
  lines.push(`| Total wall time | ${baseline?.totalWallTimeMs ?? 'n/a'} ms | ${snapshot.totalWallTimeMs} ms |`);
  lines.push(`| Smoke tests (@smoke) | ${baseline?.smoke?.ids?.length ?? 'n/a'} | ${snapshot.smokeCount} |`);
  lines.push(`| Smoke duration (sum of per-test) | n/a | ${smokeMs} ms |`);
  if (baselineAvg !== null && pwAvg !== null) {
    lines.push(`| Avg test duration | ${baselineAvg.toFixed(1)} ms | ${pwAvg.toFixed(1)} ms |`);
  }
  lines.push('');

  lines.push('## Commands');
  lines.push('');
  lines.push(`- \`npm run test:installer:pw\``);
  lines.push(`- \`npm run test:smoke\` (uses \`--grep @smoke\`)`);
  lines.push('');

  if (baseline) {
    lines.push('## Frozen smoke group (source of truth)');
    lines.push('');
    lines.push(`- Baseline file: \`tests/perf/baseline-snapshot.json\``);
    lines.push(`- Smoke file: \`tests/perf/smoke-group-frozen.json\``);
    lines.push('');
    for (const id of baseline.smoke.ids) {
      lines.push(`- \`${mdEscape(id)}\``);
    }
    lines.push('');
  }

  process.stdout.write(lines.join('\n') + '\n');
}

main();

