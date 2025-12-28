#!/usr/bin/env npx tsx
/**
 * Collects CI metrics for PR analysis.
 *
 * Metrics collected:
 * - Build time
 * - Dev startup time
 * - Bundle size
 * - Test summary
 *
 * Output: .cache/metrics/current.json
 *
 * Usage:
 *   npx tsx scripts/metrics/collect-metrics.ts [--skip-build] [--skip-dev] [--skip-tests]
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { DEFAULT_CONFIG, type PRMetrics, type TestSummary } from './types.js';

const config = DEFAULT_CONFIG;

// Parse CLI arguments
const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const skipDev = args.includes('--skip-dev');
const skipTests = args.includes('--skip-tests');

// Output file name (current.json for compatibility with history/comparison)
const OUTPUT_FILE = 'current.json';

/**
 * Ensures all cache directories exist
 */
function ensureCacheDirs(): void {
  const dirs = [
    config.metricsDir,
    config.logsDir,
    config.aiLogsDir,
    config.playwrightDir,
    '.cache/tmp',
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Runs a command and measures execution time
 */
function runAndMeasure(
  command: string,
  args: string[],
  logPath: string,
  options: { timeout?: number; cwd?: string } = {}
): { durationSec: number; success: boolean; output: string } {
  const start = Date.now();
  let success = true;
  let output = '';

  try {
    const result = execSync(`${command} ${args.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout ?? 300_000, // 5 min default
      cwd: options.cwd ?? process.cwd(),
    });
    output = result;
  } catch (error) {
    success = false;
    if (error instanceof Error) {
      const execError = error as Error & { stdout?: unknown; stderr?: unknown };
      output = String(execError.stdout ?? '') + '\n' + String(execError.stderr ?? '');
    }
  }

  const end = Date.now();
  const durationSec = Number(((end - start) / 1000).toFixed(2));

  const logContent = [
    `Command: ${command} ${args.join(' ')}`,
    `Duration: ${durationSec}s`,
    `Success: ${success}`,
    `Timestamp: ${new Date().toISOString()}`,
    '---',
    output,
  ].join('\n');

  writeFileSync(logPath, logContent);

  return { durationSec, success, output };
}

/**
 * Measures dev server startup time (starts and kills after a timeout)
 */
async function measureDevStartup(logPath: string, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve) => {
    const start = Date.now();
    let output = '';

    const child = spawn('npm', ['run', 'dev'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data) => {
      output += data.toString();
    });

    // Kill after timeout
    const killTimer = setTimeout(() => {
      child.kill('SIGTERM');
      // Give it a moment to cleanup
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 1000);
    }, timeoutMs);

    child.on('exit', () => {
      clearTimeout(killTimer);
      const end = Date.now();
      const durationSec = Number(((end - start) / 1000).toFixed(2));

      const logContent = [
        `Command: npm run dev`,
        `Duration: ${durationSec}s (killed after ${timeoutMs}ms)`,
        `Timestamp: ${new Date().toISOString()}`,
        '---',
        output,
      ].join('\n');

      writeFileSync(logPath, logContent);
      resolve(durationSec);
    });

    child.on('error', () => {
      clearTimeout(killTimer);
      resolve(0);
    });
  });
}

/**
 * Calculates total size of a directory in bytes
 */
function getDirSize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;

  let totalSize = 0;
  const items = readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    if (item.isDirectory()) {
      totalSize += getDirSize(itemPath);
    } else if (item.isFile()) {
      totalSize += statSync(itemPath).size;
    }
  }

  return totalSize;
}

/**
 * Parses test output to extract summary
 */
function parseTestOutput(output: string): TestSummary {
  // Parse Node.js test runner output format
  // Example: "# tests 42" "# pass 40" "# fail 2"
  const totalMatch = output.match(/# tests (\d+)/);
  const passMatch = output.match(/# pass (\d+)/);
  const failMatch = output.match(/# fail (\d+)/);
  const skipMatch = output.match(/# skip(?:ped)? (\d+)/);
  const durationMatch = output.match(/# duration[_\s]*(\d+(?:\.\d+)?)\s*ms/i);

  return {
    total: totalMatch ? parseInt(totalMatch[1], 10) : 0,
    passed: passMatch ? parseInt(passMatch[1], 10) : 0,
    failed: failMatch ? parseInt(failMatch[1], 10) : 0,
    skipped: skipMatch ? parseInt(skipMatch[1], 10) : 0,
    durationMs: durationMatch ? parseFloat(durationMatch[1]) : 0,
  };
}

/**
 * Gets git information for the current commit
 */
function getGitInfo(): { commitSha?: string; branch?: string } {
  try {
    const commitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return { commitSha, branch };
  } catch {
    return {};
  }
}

/**
 * Main metrics collection
 */
async function collectMetrics(): Promise<PRMetrics> {
  console.log('🔧 Setting up cache directories...');
  ensureCacheDirs();

  const metrics: PRMetrics = {
    timestamp: new Date().toISOString(),
    ...getGitInfo(),
  };

  // Build time measurement
  if (!skipBuild) {
    console.log('📦 Measuring build time...');
    // For this project, there's no explicit build script, so we can measure TypeScript compilation
    const buildResult = runAndMeasure(
      'npx',
      ['tsc', '--noEmit'],
      path.join(config.logsDir, 'build.log')
    );
    metrics.buildTimeSec = buildResult.durationSec;
    console.log(`   Build time: ${metrics.buildTimeSec}s`);
  }

  // Dev startup time measurement
  if (!skipDev) {
    console.log('🚀 Measuring dev startup time...');
    // Note: This project might not have a 'dev' script, so we skip if it doesn't exist
    try {
      const packageJson = JSON.parse(
        execSync('cat package.json', { encoding: 'utf8' })
      );
      if (packageJson.scripts?.dev) {
        metrics.devStartTimeSec = await measureDevStartup(
          path.join(config.logsDir, 'dev.log'),
          8000
        );
        console.log(`   Dev startup: ${metrics.devStartTimeSec}s`);
      } else {
        console.log('   No dev script found, skipping...');
      }
    } catch {
      console.log('   Could not measure dev startup time');
    }
  }

  // Bundle size (dist directory if exists)
  const distPath = 'dist';
  if (existsSync(distPath)) {
    metrics.bundleSizeBytes = getDirSize(distPath);
    console.log(`📊 Bundle size: ${metrics.bundleSizeBytes} bytes`);
  }

  // Test execution
  if (!skipTests) {
    console.log('🧪 Running tests...');
    const testResult = runAndMeasure(
      'npm',
      ['test'],
      path.join(config.logsDir, 'test.log'),
      { timeout: 600_000 } // 10 min for tests
    );
    metrics.tests = parseTestOutput(testResult.output);
    console.log(`   Tests: ${metrics.tests.passed}/${metrics.tests.total} passed`);
  }

  // Write metrics to file (current.json for history/comparison compatibility)
  const metricsPath = path.join(config.metricsDir, OUTPUT_FILE);
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  console.log(`\n✅ Metrics saved to ${metricsPath}`);

  // Also write to metrics.json for backwards compatibility
  const legacyPath = path.join(config.metricsDir, 'metrics.json');
  writeFileSync(legacyPath, JSON.stringify(metrics, null, 2));

  return metrics;
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  collectMetrics()
    .then((metrics) => {
      console.log('\n📈 Collected metrics:');
      console.log(JSON.stringify(metrics, null, 2));
    })
    .catch((error) => {
      console.error('Failed to collect metrics:', error);
      process.exit(1);
    });
}

export { collectMetrics, ensureCacheDirs, runAndMeasure, getDirSize };
