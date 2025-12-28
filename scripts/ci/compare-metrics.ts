#!/usr/bin/env tsx
/**
 * Compare metrics between two runs (e.g., current PR vs baseline)
 * Useful for detecting performance regressions
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
  code_additions?: number;
  code_deletions?: number;
}

interface MetricComparison {
  metric: string;
  current: number | string;
  baseline: number | string;
  diff: number | string;
  percent_change: number | string;
  status: 'improved' | 'regressed' | 'unchanged' | 'n/a';
}

function formatNumber(value: any): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  return String(value);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function compareMetric(
  name: string,
  current: number | undefined,
  baseline: number | undefined,
  higherIsBetter = false
): MetricComparison {
  if (current === undefined || baseline === undefined) {
    return {
      metric: name,
      current: formatNumber(current),
      baseline: formatNumber(baseline),
      diff: 'N/A',
      percent_change: 'N/A',
      status: 'n/a',
    };
  }

  const diff = current - baseline;
  const percentChange = baseline !== 0 ? (diff / baseline) * 100 : 0;

  let status: 'improved' | 'regressed' | 'unchanged';
  if (Math.abs(percentChange) < 1) {
    status = 'unchanged';
  } else if (higherIsBetter) {
    status = diff > 0 ? 'improved' : 'regressed';
  } else {
    status = diff < 0 ? 'improved' : 'regressed';
  }

  return {
    metric: name,
    current: formatNumber(current),
    baseline: formatNumber(baseline),
    diff: formatNumber(diff),
    percent_change: `${percentChange > 0 ? '+' : ''}${percentChange.toFixed(1)}%`,
    status,
  };
}

async function loadMetrics(filePath: string): Promise<Metrics> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load metrics from ${filePath}: ${error}`);
  }
}

async function compareMetrics(currentPath: string, baselinePath: string): Promise<void> {
  console.log('📊 Comparing metrics...\n');

  const current = await loadMetrics(currentPath);
  const baseline = await loadMetrics(baselinePath);

  const comparisons: MetricComparison[] = [
    compareMetric('Test Time (sec)', current.test_time_sec, baseline.test_time_sec, false),
    compareMetric('Build Time (sec)', current.build_time_sec, baseline.build_time_sec, false),
    compareMetric('Bundle Size (bytes)', current.bundle_size_bytes, baseline.bundle_size_bytes, false),
    compareMetric('Tests Passed', current.test_passed, baseline.test_passed, true),
    compareMetric('Tests Failed', current.test_failed, baseline.test_failed, false),
  ];

  // Print table
  console.log('┌─────────────────────────┬────────────┬────────────┬────────────┬──────────────┬──────────┐');
  console.log('│ Metric                  │ Current    │ Baseline   │ Diff       │ Change       │ Status   │');
  console.log('├─────────────────────────┼────────────┼────────────┼────────────┼──────────────┼──────────┤');

  for (const comp of comparisons) {
    const statusIcon =
      comp.status === 'improved' ? '✅' : comp.status === 'regressed' ? '❌' : comp.status === 'unchanged' ? '⚪' : '⚠️';

    console.log(
      `│ ${comp.metric.padEnd(23)} │ ${String(comp.current).padEnd(10)} │ ${String(comp.baseline).padEnd(10)} │ ${String(comp.diff).padEnd(10)} │ ${String(comp.percent_change).padEnd(12)} │ ${statusIcon} ${comp.status.padEnd(7)} │`
    );
  }

  console.log('└─────────────────────────┴────────────┴────────────┴────────────┴──────────────┴──────────┘');

  // Summary
  const regressions = comparisons.filter((c) => c.status === 'regressed').length;
  const improvements = comparisons.filter((c) => c.status === 'improved').length;

  console.log('\n📈 Summary:');
  console.log(`  ✅ Improvements: ${improvements}`);
  console.log(`  ❌ Regressions: ${regressions}`);
  console.log(`  ⚪ Unchanged: ${comparisons.filter((c) => c.status === 'unchanged').length}`);

  // Generate markdown report
  const reportPath = path.join(path.dirname(currentPath), 'comparison-report.md');
  await generateMarkdownReport(comparisons, current, baseline, reportPath);
  console.log(`\n📄 Report saved to: ${reportPath}`);

  // Exit with error if there are regressions
  if (regressions > 0) {
    console.log('\n⚠️  Performance regressions detected!');
    process.exit(1);
  }
}

async function generateMarkdownReport(
  comparisons: MetricComparison[],
  current: Metrics,
  baseline: Metrics,
  outputPath: string
): Promise<void> {
  const lines = [
    '# Metrics Comparison Report',
    '',
    `**Current Run:** ${current.timestamp}`,
    `**Baseline Run:** ${baseline.timestamp}`,
    '',
    '## Comparison',
    '',
    '| Metric | Current | Baseline | Diff | Change | Status |',
    '|--------|---------|----------|------|--------|--------|',
  ];

  for (const comp of comparisons) {
    const statusIcon =
      comp.status === 'improved' ? '✅' : comp.status === 'regressed' ? '❌' : comp.status === 'unchanged' ? '⚪' : '⚠️';

    lines.push(
      `| ${comp.metric} | ${comp.current} | ${comp.baseline} | ${comp.diff} | ${comp.percent_change} | ${statusIcon} ${comp.status} |`
    );
  }

  lines.push('');
  lines.push('## Summary');
  lines.push('');

  const regressions = comparisons.filter((c) => c.status === 'regressed');
  const improvements = comparisons.filter((c) => c.status === 'improved');

  if (regressions.length > 0) {
    lines.push('### ❌ Regressions');
    lines.push('');
    for (const reg of regressions) {
      lines.push(`- **${reg.metric}**: ${reg.percent_change} (${reg.current} vs ${reg.baseline})`);
    }
    lines.push('');
  }

  if (improvements.length > 0) {
    lines.push('### ✅ Improvements');
    lines.push('');
    for (const imp of improvements) {
      lines.push(`- **${imp.metric}**: ${imp.percent_change} (${imp.current} vs ${imp.baseline})`);
    }
    lines.push('');
  }

  await fs.writeFile(outputPath, lines.join('\n'), 'utf-8');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: compare-metrics.ts <current-metrics.json> <baseline-metrics.json>');
    console.error('');
    console.error('Example:');
    console.error('  tsx scripts/ci/compare-metrics.ts .cache/metrics/metrics.json baseline-metrics.json');
    process.exit(1);
  }

  const [currentPath, baselinePath] = args;

  try {
    await compareMetrics(currentPath, baselinePath);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { compareMetrics, loadMetrics };
