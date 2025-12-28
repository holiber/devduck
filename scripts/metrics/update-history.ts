#!/usr/bin/env npx tsx
/**
 * Updates metrics history with the current metrics.
 * Keeps last N records for trend visualization.
 * 
 * Reads:
 *   - .cache/metrics/current.json
 *   - .cache/metrics/history.json (if exists)
 * 
 * Outputs:
 *   - .cache/metrics/history.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONFIG, type PRMetrics } from './types.js';

const config = DEFAULT_CONFIG;

// Maximum number of history records to keep
const MAX_HISTORY_RECORDS = 50;

interface HistoryEntry {
  timestamp: string;
  buildTimeSec?: number;
  devStartTimeSec?: number;
  bundleSizeBytes?: number;
  commitSha?: string;
  branch?: string;
  prNumber?: number;
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

function updateHistory(): HistoryEntry[] {
  mkdirSync(config.metricsDir, { recursive: true });

  const currentPath = path.join(config.metricsDir, 'current.json');
  const historyPath = path.join(config.metricsDir, 'history.json');

  // Read current metrics
  const current = readJsonSafe<PRMetrics>(currentPath, {
    timestamp: new Date().toISOString(),
  });

  // Read existing history
  let history = readJsonSafe<HistoryEntry[]>(historyPath, []);

  // Create history entry from current metrics
  const entry: HistoryEntry = {
    timestamp: current.timestamp ?? new Date().toISOString(),
    buildTimeSec: current.buildTimeSec,
    devStartTimeSec: current.devStartTimeSec,
    bundleSizeBytes: current.bundleSizeBytes,
    commitSha: current.commitSha,
    branch: current.branch,
    prNumber: current.prNumber,
  };

  // Add to history
  history.push(entry);

  // Keep only last N records
  if (history.length > MAX_HISTORY_RECORDS) {
    history = history.slice(-MAX_HISTORY_RECORDS);
  }

  // Write updated history
  writeFileSync(historyPath, JSON.stringify(history, null, 2));

  console.log(`📈 History updated (${history.length} records)`);
  console.log(`   Latest: ${entry.timestamp} - Build: ${entry.buildTimeSec}s, Bundle: ${entry.bundleSizeBytes}B`);
  console.log(`✅ History saved to ${historyPath}`);

  return history;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateHistory();
}

export { updateHistory, type HistoryEntry };
