#!/usr/bin/env node
/**
 * Capture a baseline timing snapshot from the legacy Node.js installer tests.
 *
 * Source tests (not run by `npm test` / CI):
 * - `tests/legacy/installer/**/*.test.ts`
 *
 * Output (ignored by git):
 * - `tests/perf/baseline-snapshot.json`
 * - `tests/perf/baseline-raw-output.txt`
 * - `tests/perf/smoke-group-frozen.{json,md}` (fastest 20%)
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Timing = {
  /** Stable identifier for freezing/comparison (legacy baseline uses TAP title path). */
  id: string;
  /** Human-readable test path. */
  titlePath: string;
  durationMs: number;
};

type BaselineSnapshot = {
  kind: 'baseline';
  capturedAtUtc: string;
  totalWallTimeMs: number;
  legacyTestFiles: string[];
  timings: Timing[];
  smoke: {
    fastestPercent: number;
    ids: string[];
  };
};

function utcNow(): string {
  return new Date().toISOString();
}

function walk(dir: string, acc: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) acc.push(p);
  }
  return acc;
}

function parseTapDurations(tapText: string): Timing[] {
  // Best-effort TAP parser for Node.js `--test-reporter=tap`.
  // We build `titlePath` from nested "# Subtest:" + leaf "ok ... - <name>".
  const lines = tapText.split(/\r?\n/);
  const stack: string[] = [];
  let lastOk: string | null = null;
  const out: Timing[] = [];

  for (const line of lines) {
    const mSub = /^(\s*)# Subtest:\s*(.+)\s*$/.exec(line);
    if (mSub) {
      const depth = Math.floor((mSub[1]?.length ?? 0) / 4);
      stack.length = depth;
      stack.push((mSub[2] ?? '').trim());
      lastOk = null;
      continue;
    }

    const mOk = /^\s*ok\s+\d+\s+-\s+(.+)\s*$/.exec(line);
    if (mOk) {
      lastOk = (mOk[1] ?? '').trim();
      continue;
    }

    const mDur = /^\s*duration_ms:\s*([0-9]+(?:\.[0-9]+)?)\s*$/.exec(line);
    if (mDur && lastOk) {
      const durationMs = Number(mDur[1]);
      if (!Number.isFinite(durationMs)) continue;

      const titlePath = [...stack, lastOk].filter(Boolean).join(' › ');
      out.push({ id: titlePath, titlePath, durationMs: Math.round(durationMs) });
      lastOk = null;
    }
  }

  // Deduplicate exact repeats.
  const seen = new Set<string>();
  return out.filter(t => {
    const k = `${t.id}::${t.durationMs}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fastestPercent(timings: Timing[], percent: number): Timing[] {
  if (timings.length === 0) return [];
  const p = Math.max(0, Math.min(100, percent));
  const k = Math.max(1, Math.ceil((timings.length * p) / 100));
  return [...timings].sort((a, b) => a.durationMs - b.durationMs).slice(0, k);
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function main(): void {
  const legacyDir = path.join(process.cwd(), 'tests', 'legacy', 'installer');
  const perfDir = path.join(process.cwd(), 'tests', 'perf');
  const fastest = 20;

  mkdirSync(perfDir, { recursive: true });

  const legacyTestFiles = walk(legacyDir).sort();
  if (legacyTestFiles.length === 0) {
    throw new Error(`No legacy installer tests found under ${legacyDir}`);
  }

  const start = Date.now();
  const res = spawnSync('npx', ['tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', ...legacyTestFiles], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  const wall = Date.now() - start;

  const stdout = res.stdout?.toString() ?? '';
  const stderr = res.stderr?.toString() ?? '';
  const raw = `${stdout}\n${stderr}`;

  writeFileSync(path.join(perfDir, 'baseline-raw-output.txt'), raw, 'utf8');

  if (res.status !== 0) {
    throw new Error(`Baseline run failed (exit ${res.status}). See tests/perf/baseline-raw-output.txt`);
  }

  const timings = parseTapDurations(raw).sort((a, b) => a.durationMs - b.durationMs);
  const smoke = fastestPercent(timings, fastest);
  const smokeIds = smoke.map(t => t.id);

  const snapshot: BaselineSnapshot = {
    kind: 'baseline',
    capturedAtUtc: utcNow(),
    totalWallTimeMs: wall,
    legacyTestFiles,
    timings,
    smoke: { fastestPercent: fastest, ids: smokeIds }
  };

  writeFileSync(path.join(perfDir, 'baseline-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  writeFileSync(
    path.join(perfDir, 'smoke-group-frozen.json'),
    JSON.stringify({ kind: 'smoke-freeze', source: 'baseline-snapshot.json', fastestPercent: fastest, ids: smokeIds }, null, 2) + '\n',
    'utf8'
  );

  const md = [
    `# Smoke group (frozen)`,
    ``,
    `- Source: \`tests/perf/baseline-snapshot.json\``,
    `- Policy: fastest ${fastest}% of legacy installer tests`,
    `- Count: ${smokeIds.length}/${timings.length}`,
    ``,
    ...smoke.map((t, i) => `- ${i + 1}. \`${t.id}\` (${t.durationMs}ms)`)
  ].join('\n');
  writeFileSync(path.join(perfDir, 'smoke-group-frozen.md'), md + '\n', 'utf8');

  if (!hasFlag('--quiet')) {
    // eslint-disable-next-line no-console
    console.log(`Baseline captured: tests/perf/baseline-snapshot.json (${timings.length} timings, ${wall}ms wall time)`);
    // eslint-disable-next-line no-console
    console.log(`Smoke frozen: tests/perf/smoke-group-frozen.json (${smokeIds.length} tests)`);
  }
}

main();

