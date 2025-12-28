#!/usr/bin/env tsx
/**
 * Visualize metrics trends over time
 * Creates ASCII charts and summary reports
 */
import fs from 'fs/promises';
import path from 'path';

interface Metrics {
  timestamp: string;
  build_time_sec?: number;
  test_time_sec?: number;
  bundle_size_bytes?: number;
  test_count?: number;
  test_passed?: number;
  test_failed?: number;
  pr_number?: number;
  commit_sha?: string;
}

interface MetricsHistory {
  metrics: Metrics[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function createAsciiChart(values: number[], width = 60, height = 10): string[] {
  if (values.length === 0) return ['No data'];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const lines: string[] = [];

  // Create chart
  for (let row = height - 1; row >= 0; row--) {
    let line = '';
    const threshold = min + (range * row) / (height - 1);

    for (let col = 0; col < Math.min(values.length, width); col++) {
      const value = values[col];
      line += value >= threshold ? '█' : ' ';
    }

    // Add scale
    const label = threshold.toFixed(1).padStart(8);
    lines.push(`${label} │${line}`);
  }

  // Add bottom axis
  lines.push('         └' + '─'.repeat(Math.min(values.length, width)));

  return lines;
}

function calculateStats(values: number[]): {
  min: number;
  max: number;
  avg: number;
  median: number;
} {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, median: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
  };
}

async function loadMetricsHistory(directory: string): Promise<Metrics[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const metrics: Metrics[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'comparison-report.json') {
      try {
        const content = await fs.readFile(path.join(directory, entry.name), 'utf-8');
        const metric = JSON.parse(content);
        metrics.push(metric);
      } catch {
        // Skip invalid files
      }
    }
  }

  // Sort by timestamp
  metrics.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return metrics;
}

async function visualizeMetrics(metricsDir: string): Promise<void> {
  console.log('📊 Loading metrics history...\n');

  const metrics = await loadMetricsHistory(metricsDir);

  if (metrics.length === 0) {
    console.log('⚠️  No metrics found in', metricsDir);
    return;
  }

  console.log(`Found ${metrics.length} metric snapshots\n`);
  console.log('═'.repeat(70));

  // Visualize test time
  const testTimes = metrics.map((m) => m.test_time_sec).filter((t): t is number => t !== undefined);
  if (testTimes.length > 0) {
    console.log('\n🧪 Test Time Trend (seconds)');
    console.log('─'.repeat(70));
    const chart = createAsciiChart(testTimes);
    chart.forEach((line) => console.log(line));

    const stats = calculateStats(testTimes);
    console.log(`\nStats: min=${stats.min.toFixed(2)}s, max=${stats.max.toFixed(2)}s, avg=${stats.avg.toFixed(2)}s, median=${stats.median.toFixed(2)}s`);
  }

  // Visualize build time
  const buildTimes = metrics.map((m) => m.build_time_sec).filter((t): t is number => t !== undefined);
  if (buildTimes.length > 0) {
    console.log('\n📦 Build Time Trend (seconds)');
    console.log('─'.repeat(70));
    const chart = createAsciiChart(buildTimes);
    chart.forEach((line) => console.log(line));

    const stats = calculateStats(buildTimes);
    console.log(`\nStats: min=${stats.min.toFixed(2)}s, max=${stats.max.toFixed(2)}s, avg=${stats.avg.toFixed(2)}s, median=${stats.median.toFixed(2)}s`);
  }

  // Visualize bundle size
  const bundleSizes = metrics.map((m) => m.bundle_size_bytes).filter((t): t is number => t !== undefined);
  if (bundleSizes.length > 0) {
    console.log('\n📏 Bundle Size Trend');
    console.log('─'.repeat(70));
    const chart = createAsciiChart(bundleSizes);
    chart.forEach((line) => console.log(line));

    const stats = calculateStats(bundleSizes);
    console.log(
      `\nStats: min=${formatBytes(stats.min)}, max=${formatBytes(stats.max)}, avg=${formatBytes(stats.avg)}, median=${formatBytes(stats.median)}`
    );
  }

  // Recent changes
  console.log('\n📈 Recent Metrics (last 5 runs)');
  console.log('─'.repeat(70));

  const recent = metrics.slice(-5);
  console.log('│ Date       │ Test Time │ Build Time │ Bundle Size │ PR     │');
  console.log('├────────────┼───────────┼────────────┼─────────────┼────────┤');

  for (const m of recent) {
    const date = new Date(m.timestamp).toISOString().split('T')[0];
    const testTime = m.test_time_sec ? `${m.test_time_sec.toFixed(1)}s` : 'N/A';
    const buildTime = m.build_time_sec ? `${m.build_time_sec.toFixed(1)}s` : 'N/A';
    const bundleSize = m.bundle_size_bytes ? formatBytes(m.bundle_size_bytes) : 'N/A';
    const pr = m.pr_number ? `#${m.pr_number}` : 'N/A';

    console.log(
      `│ ${date} │ ${testTime.padEnd(9)} │ ${buildTime.padEnd(10)} │ ${bundleSize.padEnd(11)} │ ${pr.padEnd(6)} │`
    );
  }

  console.log('═'.repeat(70));

  // Save summary
  const summaryPath = path.join(metricsDir, 'metrics-summary.md');
  await generateSummary(metrics, summaryPath);
  console.log(`\n📄 Summary saved to: ${summaryPath}`);
}

async function generateSummary(metrics: Metrics[], outputPath: string): Promise<void> {
  const lines = [
    '# Metrics Summary',
    '',
    `**Total Snapshots:** ${metrics.length}`,
    `**Date Range:** ${new Date(metrics[0].timestamp).toISOString()} to ${new Date(metrics[metrics.length - 1].timestamp).toISOString()}`,
    '',
  ];

  // Test time stats
  const testTimes = metrics.map((m) => m.test_time_sec).filter((t): t is number => t !== undefined);
  if (testTimes.length > 0) {
    const stats = calculateStats(testTimes);
    lines.push('## Test Time');
    lines.push('');
    lines.push(`- **Min:** ${stats.min.toFixed(2)}s`);
    lines.push(`- **Max:** ${stats.max.toFixed(2)}s`);
    lines.push(`- **Average:** ${stats.avg.toFixed(2)}s`);
    lines.push(`- **Median:** ${stats.median.toFixed(2)}s`);
    lines.push('');
  }

  // Build time stats
  const buildTimes = metrics.map((m) => m.build_time_sec).filter((t): t is number => t !== undefined);
  if (buildTimes.length > 0) {
    const stats = calculateStats(buildTimes);
    lines.push('## Build Time');
    lines.push('');
    lines.push(`- **Min:** ${stats.min.toFixed(2)}s`);
    lines.push(`- **Max:** ${stats.max.toFixed(2)}s`);
    lines.push(`- **Average:** ${stats.avg.toFixed(2)}s`);
    lines.push(`- **Median:** ${stats.median.toFixed(2)}s`);
    lines.push('');
  }

  // Bundle size stats
  const bundleSizes = metrics.map((m) => m.bundle_size_bytes).filter((t): t is number => t !== undefined);
  if (bundleSizes.length > 0) {
    const stats = calculateStats(bundleSizes);
    lines.push('## Bundle Size');
    lines.push('');
    lines.push(`- **Min:** ${formatBytes(stats.min)}`);
    lines.push(`- **Max:** ${formatBytes(stats.max)}`);
    lines.push(`- **Average:** ${formatBytes(stats.avg)}`);
    lines.push(`- **Median:** ${formatBytes(stats.median)}`);
    lines.push('');
  }

  // Recent runs
  lines.push('## Recent Runs');
  lines.push('');
  lines.push('| Date | Test Time | Build Time | Bundle Size | PR |');
  lines.push('|------|-----------|------------|-------------|-----|');

  const recent = metrics.slice(-10);
  for (const m of recent) {
    const date = new Date(m.timestamp).toISOString().split('T')[0];
    const testTime = m.test_time_sec ? `${m.test_time_sec.toFixed(1)}s` : 'N/A';
    const buildTime = m.build_time_sec ? `${m.build_time_sec.toFixed(1)}s` : 'N/A';
    const bundleSize = m.bundle_size_bytes ? formatBytes(m.bundle_size_bytes) : 'N/A';
    const pr = m.pr_number ? `#${m.pr_number}` : 'N/A';

    lines.push(`| ${date} | ${testTime} | ${buildTime} | ${bundleSize} | ${pr} |`);
  }

  await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
}

async function main() {
  const args = process.argv.slice(2);
  const metricsDir = args[0] || '.cache/metrics';

  try {
    await visualizeMetrics(metricsDir);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { visualizeMetrics, loadMetricsHistory };
