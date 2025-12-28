#!/usr/bin/env npx tsx
/**
 * Compares current metrics with baseline (from main branch).
 * 
 * Reads:
 *   - .cache/metrics/current.json
 *   - .cache/metrics/baseline.json
 * 
 * Outputs:
 *   - .cache/metrics/diff.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONFIG } from './types.js';

const config = DEFAULT_CONFIG;

interface MetricsDiff {
  buildDelta: number;
  devDelta: number;
  bundleDelta: number;
  current: {
    buildTimeSec: number;
    devStartTimeSec: number;
    bundleSizeBytes: number;
  };
  baseline: {
    buildTimeSec: number;
    devStartTimeSec: number;
    bundleSizeBytes: number;
  };
  timestamp: string;
}

function readJsonSafe<T>(filePath: string, defaultValue: T): T {
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf8')) as T;
    }
  } catch {
    console.warn(`Warning: Could not read ${filePath}`);
  }
  return defaultValue;
}

function compareMetrics(): MetricsDiff {
  mkdirSync(config.metricsDir, { recursive: true });

  const currentPath = path.join(config.metricsDir, 'current.json');
  const baselinePath = path.join(config.metricsDir, 'baseline.json');

  const current = readJsonSafe(currentPath, {
    buildTimeSec: 0,
    devStartTimeSec: 0,
    bundleSizeBytes: 0,
  });

  const baseline = readJsonSafe(baselinePath, {
    buildTimeSec: 0,
    devStartTimeSec: 0,
    bundleSizeBytes: 0,
  });

  const diff: MetricsDiff = {
    buildDelta: Number(((current.buildTimeSec ?? 0) - (baseline.buildTimeSec ?? 0)).toFixed(2)),
    devDelta: Number(((current.devStartTimeSec ?? 0) - (baseline.devStartTimeSec ?? 0)).toFixed(2)),
    bundleDelta: (current.bundleSizeBytes ?? 0) - (baseline.bundleSizeBytes ?? 0),
    current: {
      buildTimeSec: current.buildTimeSec ?? 0,
      devStartTimeSec: current.devStartTimeSec ?? 0,
      bundleSizeBytes: current.bundleSizeBytes ?? 0,
    },
    baseline: {
      buildTimeSec: baseline.buildTimeSec ?? 0,
      devStartTimeSec: baseline.devStartTimeSec ?? 0,
      bundleSizeBytes: baseline.bundleSizeBytes ?? 0,
    },
    timestamp: new Date().toISOString(),
  };

  const diffPath = path.join(config.metricsDir, 'diff.json');
  writeFileSync(diffPath, JSON.stringify(diff, null, 2));

  console.log('📊 Metrics comparison:');
  console.log(`   Build time: ${diff.current.buildTimeSec}s (Δ ${diff.buildDelta > 0 ? '+' : ''}${diff.buildDelta}s)`);
  console.log(`   Dev start:  ${diff.current.devStartTimeSec}s (Δ ${diff.devDelta > 0 ? '+' : ''}${diff.devDelta}s)`);
  console.log(`   Bundle:     ${diff.current.bundleSizeBytes}B (Δ ${diff.bundleDelta > 0 ? '+' : ''}${diff.bundleDelta}B)`);
  console.log(`\n✅ Diff saved to ${diffPath}`);

  return diff;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  compareMetrics();
}

export { compareMetrics };
